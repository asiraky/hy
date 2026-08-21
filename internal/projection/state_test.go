package projection

import (
	"encoding/json"
	"testing"

	"github.com/asiraky/hy/internal/proto"
)

func event(t *testing.T, seq int64, typ string, payload any) proto.Event {
	t.Helper()
	blob, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return proto.Event{Seq: seq, Type: typ, Payload: blob}
}

// A harness-initiated turn has no prompt: it must open the turn and flip the
// phase, but not fabricate an empty user message in the timeline.
func TestHarnessInitiatedTurnHasNoPromptItem(t *testing.T) {
	s := New("s1")
	s.Apply(event(t, 1, proto.TurnStarted, proto.TurnStartedPayload{TurnID: "t1"}))

	if s.Phase != "turn" {
		t.Fatalf("phase = %q, want turn", s.Phase)
	}
	if len(s.Turns) != 1 || s.Turns[0].ID != "t1" {
		t.Fatalf("turns = %+v, want one turn t1", s.Turns)
	}
	if len(s.Items) != 0 {
		t.Fatalf("items = %+v, want none: an unprompted turn has no user message", s.Items)
	}

	s.Apply(event(t, 2, proto.TurnFinished, proto.TurnFinishedPayload{TurnID: "t1", StopReason: proto.StopEndTurn}))
	if s.Phase != "idle" || !s.Turns[0].Done {
		t.Fatalf("after finish: phase=%q done=%v, want idle/true", s.Phase, s.Turns[0].Done)
	}
}

// A turn carries when it started and finished, from the events' own clock:
// the UI labels a folded turn "Worked for 34s" from these. Mirrored by
// web/src/apply.test.ts.
func TestTurnRecordsItsTimestamps(t *testing.T) {
	s := New("s1")
	started := event(t, 1, proto.TurnStarted, proto.TurnStartedPayload{TurnID: "t1", Prompt: "go"})
	started.Timestamp = 1000
	s.Apply(started)
	finished := event(t, 2, proto.TurnFinished, proto.TurnFinishedPayload{TurnID: "t1", StopReason: proto.StopEndTurn})
	finished.Timestamp = 35000
	s.Apply(finished)

	if s.Turns[0].StartedAt != 1000 || s.Turns[0].FinishedAt != 35000 {
		t.Fatalf("turn timestamps = %d/%d, want 1000/35000", s.Turns[0].StartedAt, s.Turns[0].FinishedAt)
	}
}

// A prompted turn still records the prompt as a timeline item.
func TestPromptedTurnKeepsItsPromptItem(t *testing.T) {
	s := New("s1")
	s.Apply(event(t, 1, proto.TurnStarted, proto.TurnStartedPayload{TurnID: "t1", Prompt: "do the thing"}))

	if len(s.Items) != 1 || s.Items[0].Text != "do the thing" {
		t.Fatalf("items = %+v, want the prompt item", s.Items)
	}
}

// Streaming while idle is evidence a turn is running that the log did not
// announce. The projection trusts the activity over the phase, so a lifecycle
// desync cannot freeze attached UIs. web/src/apply.ts mirrors this.
func TestStreamingWhileIdleImpliesTurn(t *testing.T) {
	s := New("s1")
	s.Apply(event(t, 1, proto.MessageChunk, proto.MessageChunkPayload{
		TurnID: "", Role: "agent", Kind: "text", BlockID: "b1", Delta: "The web",
	}))
	if s.Phase != "turn" {
		t.Fatalf("phase after message.chunk while idle = %q, want turn", s.Phase)
	}

	s2 := New("s2")
	s2.Apply(event(t, 1, proto.ToolCallStarted, proto.ToolCallStartedPayload{
		ToolCallID: "c1", Kind: proto.KindExecute, Title: "ls", Status: proto.StatusPending,
	}))
	if s2.Phase != "turn" {
		t.Fatalf("phase after tool_call.started while idle = %q, want turn", s2.Phase)
	}
}

// The defence must not resurrect a closed session.
func TestStreamingDoesNotReopenClosedSession(t *testing.T) {
	s := New("s1")
	s.Apply(event(t, 1, proto.SessionClosed, proto.SessionClosedPayload{Reason: "closed"}))
	s.Apply(event(t, 2, proto.MessageChunk, proto.MessageChunkPayload{
		Role: "agent", Kind: "text", BlockID: "b1", Delta: "late",
	}))
	if s.Phase != "closed" {
		t.Fatalf("phase = %q, want closed", s.Phase)
	}
}

// Effort is the one config field whose empty value is a choice rather than an
// absence: clearing it hands the level back to the harness. A payload that
// says so must be able to say so, or the composer keeps showing — and a
// restart keeps resuming — a level the session no longer runs at. Mirrored by
// web/src/apply.test.ts.
func TestClearingEffortSticks(t *testing.T) {
	s := New("s1")
	high, cleared := "high", ""

	s.Apply(event(t, 1, proto.SessionConfigChanged, proto.SessionConfigChangedPayload{Effort: &high}))
	if s.Effort != "high" {
		t.Fatalf("effort = %q, want high", s.Effort)
	}

	s.Apply(event(t, 2, proto.SessionConfigChanged, proto.SessionConfigChangedPayload{Effort: &cleared}))
	if s.Effort != "" {
		t.Fatalf("effort = %q after clearing, want empty", s.Effort)
	}

	// An event about something else still leaves effort alone.
	s.Apply(event(t, 3, proto.SessionConfigChanged, proto.SessionConfigChangedPayload{Effort: &high}))
	s.Apply(event(t, 4, proto.SessionConfigChanged, proto.SessionConfigChangedPayload{Model: "sonnet"}))
	if s.Effort != "high" {
		t.Fatalf("effort = %q after an unrelated change, want high", s.Effort)
	}
}
