package session

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/asiraky/hy/internal/adapter"
	"github.com/asiraky/hy/internal/projection"
	"github.com/asiraky/hy/internal/proto"
	"github.com/asiraky/hy/internal/store"
)

// fakeAdapter emits scripted events, so the seam can be tested without a real
// harness process.
type fakeAdapter struct {
	mu   sync.Mutex
	last *fakeSession
}

func (f *fakeAdapter) ID() string { return "fake" }

func (f *fakeAdapter) Meta() adapter.HarnessMeta {
	return adapter.HarnessMeta{ID: "fake", Name: "Fake", Accent: "oklch(0.7 0 0)"}
}

func (f *fakeAdapter) Models() []adapter.ModelMeta {
	return []adapter.ModelMeta{{ID: "", Label: "Default"}}
}

func (f *fakeAdapter) Probe(ctx context.Context) adapter.Availability {
	return adapter.Ready(nil)
}

func (f *fakeAdapter) CreateSession(ctx context.Context, host adapter.HostServices, o adapter.CreateOptions) (adapter.Session, error) {
	s := &fakeSession{host: host, events: make(chan proto.Emission, 4096), prompts: make(chan adapter.PromptInput, 16)}
	f.mu.Lock()
	f.last = s
	f.mu.Unlock()
	return s, nil
}

func (f *fakeAdapter) session() *fakeSession {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.last
}

type fakeSession struct {
	host         adapter.HostServices
	events       chan proto.Emission
	prompts      chan adapter.PromptInput
	closeOnce    sync.Once
	closeStarted chan struct{}
	closeRelease <-chan struct{}
}

func (s *fakeSession) Prompt(ctx context.Context, in adapter.PromptInput) error {
	s.prompts <- in
	return nil
}
func (s *fakeSession) Cancel(ctx context.Context) error { return nil }
func (s *fakeSession) Events() <-chan proto.Emission    { return s.events }
func (s *fakeSession) Close() error {
	s.closeOnce.Do(func() {
		if s.closeStarted != nil {
			close(s.closeStarted)
		}
		if s.closeRelease != nil {
			<-s.closeRelease
		}
		close(s.events)
	})
	return nil
}
func (s *fakeSession) emit(e proto.Emission) { s.events <- e }

func newTestActor(t *testing.T) (*Actor, *fakeAdapter, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	fa := &fakeAdapter{}
	mgr := NewManager(st, func(string, ...any) {}, fa)
	actor, err := mgr.Create(context.Background(), "fake", t.TempDir(), "", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { mgr.Shutdown() })

	waitFor(t, func() bool { return actor.Head() >= 1 }) // session.created landed
	return actor, fa, st
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("condition not met within 5s")
}

// Invariant 1: seq is gapless and strictly increasing.
func TestSeqIsGaplessAndMonotonic(t *testing.T) {
	actor, fa, st := newTestActor(t)
	sess := fa.session()

	for i := 0; i < 50; i++ {
		sess.emit(proto.Emit(proto.MessageChunk, proto.MessageChunkPayload{
			Role: "agent", Kind: "text", BlockID: "b1", Delta: "x",
		}))
	}
	waitFor(t, func() bool { return actor.Head() >= 51 })

	evs, err := st.ReadEvents(context.Background(), actor.ID, 0, 1000)
	if err != nil {
		t.Fatal(err)
	}
	for i, ev := range evs {
		if ev.Seq != int64(i+1) {
			t.Fatalf("event %d has seq %d; want %d", i, ev.Seq, i+1)
		}
	}
}

// Invariant 2: rebuilding from the log alone yields identical state.
func TestRebuildFromLogMatchesLiveState(t *testing.T) {
	actor, fa, st := newTestActor(t)
	sess := fa.session()

	for i := 0; i < 20; i++ {
		sess.emit(proto.Emit(proto.MessageChunk, proto.MessageChunkPayload{
			Role: "agent", Kind: "text", BlockID: "b1", Delta: "chunk ",
		}))
	}
	sess.emit(proto.Emit(proto.ToolCallStarted, proto.ToolCallStartedPayload{
		ToolCallID: "t1", Kind: proto.KindExecute, Title: "ls", Status: proto.StatusInProgress,
	}))
	waitFor(t, func() bool { return actor.Head() >= 22 })

	live, err := actor.State(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	rebuilt := projection.New(actor.ID)
	evs, _ := st.ReadEvents(context.Background(), actor.ID, 0, 10000)
	for _, ev := range evs {
		rebuilt.Apply(ev)
	}

	a, _ := json.Marshal(live)
	b, _ := json.Marshal(rebuilt)
	if string(a) != string(b) {
		t.Fatalf("rebuilt state differs from live state:\nlive:    %s\nrebuilt: %s", a, b)
	}
}

// Invariant 4: a client that discards seq <= lastApplied converges even when
// the same event is delivered twice.
func TestDuplicateApplyIsIdempotent(t *testing.T) {
	actor, fa, _ := newTestActor(t)
	sess := fa.session()

	sess.emit(proto.Emit(proto.MessageChunk, proto.MessageChunkPayload{
		Role: "agent", Kind: "text", BlockID: "b1", Delta: "hello",
	}))
	waitFor(t, func() bool { return actor.Head() >= 2 })

	state, _ := actor.State(context.Background())
	before, _ := json.Marshal(state)

	// Replay every event a second time.
	evs, _ := actor.store.ReadEvents(context.Background(), actor.ID, 0, 1000)
	for _, ev := range evs {
		state.Apply(ev)
	}
	after, _ := json.Marshal(state)

	if string(before) != string(after) {
		t.Fatalf("re-applying events changed state:\nbefore: %s\nafter:  %s", before, after)
	}
}

// Invariant 6: no event is skipped or duplicated across the attach seam, even
// when events land while the attach is in flight.
func TestAttachCompletenessUnderConcurrentAppends(t *testing.T) {
	actor, fa, _ := newTestActor(t)
	sess := fa.session()

	// Background writer, so events land during the attach.
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-stop:
				return
			default:
				sess.emit(proto.Emit(proto.MessageChunk, proto.MessageChunkPayload{
					Role: "agent", Kind: "text", BlockID: "b1", Delta: "x",
				}))
				time.Sleep(time.Millisecond)
			}
		}
	}()

	time.Sleep(20 * time.Millisecond)

	// The attach order under test: subscribe, then read history.
	sub := actor.Subscribe()
	defer actor.Unsubscribe(sub)

	res, err := actor.Attach(context.Background(), 0, false)
	if err != nil {
		t.Fatal(err)
	}

	seen := []int64{}
	last := res.Seq
	deadline := time.After(2 * time.Second)
collect:
	for len(seen) < 20 {
		select {
		case ev := <-sub.Ch:
			if ev.Seq <= last {
				continue // catch-up already covered it
			}
			seen = append(seen, ev.Seq)
		case <-deadline:
			break collect
		}
	}
	close(stop)
	<-done

	if len(seen) == 0 {
		t.Fatal("received no live events after attach")
	}
	want := last + 1
	for _, s := range seen {
		if s != want {
			t.Fatalf("gap or duplicate at the attach seam: got seq %d, want %d (snapshot at %d)", s, want, last)
		}
		want++
	}
}

// Invariant 9: any presenter may resolve a pending permission; the first wins
// and the loser gets an ack rather than an error.
func TestPermissionIsFungibleAndFirstResolutionWins(t *testing.T) {
	actor, fa, _ := newTestActor(t)
	sess := fa.session()

	outcomes := make(chan adapter.PermissionOutcome, 1)
	go func() {
		out, err := sess.host.RequestPermission(context.Background(), adapter.PermissionRequest{
			ToolCallID: "t1", ToolName: "Bash", Title: "rm -rf /",
		})
		if err != nil {
			t.Error(err)
			return
		}
		outcomes <- out
	}()

	// The request is durable state, so it shows up in the projection.
	var requestID string
	waitFor(t, func() bool {
		st, err := actor.State(context.Background())
		if err != nil || len(st.Pending) == 0 {
			return false
		}
		requestID = st.Pending[0].RequestID
		return true
	})

	// Two presenters answer at once; exactly one resolution takes effect.
	results := make(chan string, 2)
	var wg sync.WaitGroup
	for i, o := range []string{proto.OutcomeAllowOnce, proto.OutcomeRejectOnce} {
		wg.Add(1)
		go func(i int, o string) {
			defer wg.Done()
			err := actor.ResolvePermission(context.Background(), requestID, adapter.PermissionOutcome{Outcome: o})
			if err != nil {
				results <- "error:" + err.Error()
				return
			}
			results <- "ok"
		}(i, o)
	}
	wg.Wait()
	close(results)

	for r := range results {
		if r != "ok" {
			t.Fatalf("a presenter got %q; losing a permission race must be an ack, not an error", r)
		}
	}

	select {
	case <-outcomes:
	case <-time.After(2 * time.Second):
		t.Fatal("adapter was never unblocked by the resolution")
	}

	// Exactly one permission.resolved was appended.
	evs, _ := actor.store.ReadEvents(context.Background(), actor.ID, 0, 10000)
	n := 0
	for _, ev := range evs {
		if ev.Type == proto.PermissionResolved {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("appended %d permission.resolved events; want exactly 1", n)
	}

	st, _ := actor.State(context.Background())
	if len(st.Pending) != 0 {
		t.Fatalf("pending permission survived resolution: %+v", st.Pending)
	}
}

func TestElicitationIsDurableAndFungible(t *testing.T) {
	actor, fa, _ := newTestActor(t)
	resultCh := make(chan adapter.ElicitationResult, 1)
	go func() {
		result, err := fa.session().host.Elicit(context.Background(), adapter.ElicitationRequest{
			Prompt: "Choose", Schema: json.RawMessage(`{"type":"object"}`),
		})
		if err != nil {
			t.Error(err)
			return
		}
		resultCh <- result
	}()

	var requestID string
	waitFor(t, func() bool {
		state, err := actor.State(context.Background())
		if err != nil || len(state.Elicitations) != 1 {
			return false
		}
		requestID = state.Elicitations[0].RequestID
		return true
	})

	want := json.RawMessage(`{"answer":"yes"}`)
	if err := actor.ResolveElicitation(context.Background(), requestID, adapter.ElicitationResult{Action: "accept", Value: want}); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-resultCh:
		if got.Action != "accept" || string(got.Value) != string(want) {
			t.Fatalf("elicitation result=%+v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("adapter was not unblocked")
	}
	state, _ := actor.State(context.Background())
	if len(state.Elicitations) != 0 {
		t.Fatalf("resolved elicitation remains pending: %+v", state.Elicitations)
	}
}

// Invariant 12: a stalled consumer is dropped and resynced. Its queue never
// grows and the session actor never blocks on it.
func TestSlowConsumerIsDroppedAndResynced(t *testing.T) {
	actor, fa, _ := newTestActor(t)
	sess := fa.session()

	slow := actor.Subscribe() // never drained
	fast := actor.Subscribe()
	defer actor.Unsubscribe(fast)

	drained := make(chan struct{})
	go func() {
		defer close(drained)
		for range fast.Ch {
		}
	}()

	total := SubscriberQueue * 3
	for i := 0; i < total; i++ {
		sess.emit(proto.Emit(proto.MessageChunk, proto.MessageChunkPayload{
			Role: "agent", Kind: "text", BlockID: "b1", Delta: "x",
		}))
	}

	// The actor kept making progress despite the stalled subscriber.
	waitFor(t, func() bool { return actor.Head() >= int64(total) })

	select {
	case <-slow.Resync:
	case <-time.After(2 * time.Second):
		t.Fatal("slow consumer was never asked to resync")
	}

	if got := len(slow.Ch); got > SubscriberQueue {
		t.Fatalf("slow consumer queue grew to %d; bound is %d", got, SubscriberQueue)
	}

	actor.Unsubscribe(fast)
}

// Invariant 8: losing every client does not interrupt a turn.
func TestDisconnectIsNotCancel(t *testing.T) {
	actor, fa, _ := newTestActor(t)
	sess := fa.session()

	turnID, err := actor.Prompt(context.Background(), "do a thing")
	if err != nil {
		t.Fatal(err)
	}
	<-sess.prompts

	// A presenter attaches and leaves mid-turn.
	sub := actor.Subscribe()
	actor.Unsubscribe(sub)

	sess.emit(proto.Emit(proto.MessageChunk, proto.MessageChunkPayload{
		TurnID: turnID, Role: "agent", Kind: "text", BlockID: "b1", Delta: "still working",
	}))
	sess.emit(proto.Emit(proto.TurnFinished, proto.TurnFinishedPayload{
		TurnID: turnID, StopReason: proto.StopEndTurn,
	}))

	waitFor(t, func() bool {
		st, err := actor.State(context.Background())
		return err == nil && len(st.Turns) == 1 && st.Turns[0].Done
	})

	st, _ := actor.State(context.Background())
	if st.Turns[0].StopReason != proto.StopEndTurn {
		t.Fatalf("turn ended with %q; the disconnect must not have cancelled it", st.Turns[0].StopReason)
	}
}

// Invariant 5: the same commandId executes at most once.
func TestCommandIdempotency(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "cmd.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	ctx := context.Background()
	if _, done, err := st.ClaimCommand(ctx, "cmd-1", "s1"); err != nil || done {
		t.Fatalf("first claim: done=%v err=%v; want a fresh claim", done, err)
	}
	if _, _, err := st.ClaimCommand(ctx, "cmd-1", "s1"); !errors.Is(err, store.ErrCommandInProgress) {
		t.Fatalf("concurrent retry err=%v; want ErrCommandInProgress", err)
	}
	if err := st.CompleteCommand(ctx, "cmd-1", map[string]any{"turnId": "abc"}); err != nil {
		t.Fatal(err)
	}
	stored, done, err := st.ClaimCommand(ctx, "cmd-1", "s1")
	if err != nil || !done {
		t.Fatalf("retry: done=%v err=%v; want the stored result", done, err)
	}
	if string(stored) != `{"turnId":"abc"}` {
		t.Fatalf("retry returned %s; want the stored result", stored)
	}

	if _, done, err := st.ClaimCommand(ctx, "cmd-2", "s1"); err != nil || done {
		t.Fatalf("failed-command claim: done=%v err=%v", done, err)
	}
	if err := st.ReleaseCommand(ctx, "cmd-2"); err != nil {
		t.Fatal(err)
	}
	if _, done, err := st.ClaimCommand(ctx, "cmd-2", "s1"); err != nil || done {
		t.Fatalf("released retry: done=%v err=%v; want a fresh claim", done, err)
	}
}

func TestResumeFinishesInterruptedTurnAndCancelsPendingPermission(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "resume.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	fa := &fakeAdapter{}
	mgr := NewManager(st, func(string, ...any) {}, fa)
	actor, err := mgr.Create(context.Background(), "fake", t.TempDir(), "", "")
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return actor.Head() >= 1 })
	if _, err := actor.Prompt(context.Background(), "keep working"); err != nil {
		t.Fatal(err)
	}

	permissionDone := make(chan adapter.PermissionOutcome, 1)
	go func() {
		out, _ := fa.session().host.RequestPermission(context.Background(), adapter.PermissionRequest{Title: "approve"})
		permissionDone <- out
	}()
	waitFor(t, func() bool {
		s, _ := actor.State(context.Background())
		return s.Phase == "turn" && len(s.Pending) == 1
	})

	id := actor.ID
	mgr.Shutdown()
	if out := <-permissionDone; out.Outcome != proto.OutcomeCancelled {
		t.Fatalf("shutdown resolved permission as %q; want cancelled", out.Outcome)
	}

	mgr2 := NewManager(st, func(string, ...any) {}, fa)
	defer mgr2.Shutdown()
	resumed, err := mgr2.Get(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		s, _ := resumed.State(context.Background())
		return s.Phase == "idle" && len(s.Pending) == 0 && len(s.Turns) == 1 && s.Turns[0].Done
	})
	state, _ := resumed.State(context.Background())
	if state.Turns[0].StopReason != proto.StopError {
		t.Fatalf("interrupted turn stop reason=%q; want error", state.Turns[0].StopReason)
	}
}

func TestClosedSessionRemainsAttachableWithoutHarness(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "closed.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	fa := &fakeAdapter{}
	mgr := NewManager(st, func(string, ...any) {}, fa)
	defer mgr.Shutdown()

	actor, err := mgr.Create(context.Background(), "fake", t.TempDir(), "", "")
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return actor.Head() >= 1 })
	id := actor.ID
	if err := mgr.Close(context.Background(), id, "test"); err != nil {
		t.Fatal(err)
	}

	view, err := mgr.Get(context.Background(), id)
	if err != nil {
		t.Fatalf("get closed transcript: %v", err)
	}
	state, err := view.State(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !state.Closed || state.Phase != "closed" {
		t.Fatalf("closed transcript state: closed=%v phase=%q", state.Closed, state.Phase)
	}
	if _, err := view.Prompt(context.Background(), "must not run"); !errors.Is(err, ErrClosed) {
		t.Fatalf("prompt on closed transcript err=%v; want ErrClosed", err)
	}
}

func TestGetCannotResumeWhileCloseIsInProgress(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "lifecycle.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	fa := &fakeAdapter{}
	mgr := NewManager(st, func(string, ...any) {}, fa)
	defer mgr.Shutdown()
	actor, err := mgr.Create(context.Background(), "fake", t.TempDir(), "", "")
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return actor.Head() >= 1 })

	started := make(chan struct{})
	release := make(chan struct{})
	fa.session().closeStarted = started
	fa.session().closeRelease = release
	closeDone := make(chan error, 1)
	go func() { closeDone <- mgr.Close(context.Background(), actor.ID, "test") }()
	<-started

	getDone := make(chan error, 1)
	go func() {
		view, err := mgr.Get(context.Background(), actor.ID)
		if err == nil {
			state, stateErr := view.State(context.Background())
			if stateErr != nil {
				err = stateErr
			} else if !state.Closed {
				err = errors.New("Get returned a writable actor during close")
			}
		}
		getDone <- err
	}()
	select {
	case err := <-getDone:
		t.Fatalf("Get completed before close committed: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if err := <-closeDone; err != nil {
		t.Fatal(err)
	}
	if err := <-getDone; err != nil {
		t.Fatal(err)
	}
}
