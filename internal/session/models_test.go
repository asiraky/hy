package session

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/asiraky/hy/internal/adapter"
	"github.com/asiraky/hy/internal/store"
)

func modelsTestManager(t *testing.T, fa *fakeAdapter) *Manager {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return NewManager(st, func(string, ...any) {}, fa)
}

// Listing harnesses runs on every connection. Asking a harness for its
// catalogue costs a process start, so the first listing must answer from the
// adapter's fallback rather than waiting for one.
func TestHarnessesServeFallbackModelsWithoutBlocking(t *testing.T) {
	fa := &fakeAdapter{live: []adapter.ModelMeta{{ID: "live", Label: "Live"}}}
	fa.listGate = make(chan struct{})
	mgr := modelsTestManager(t, fa)

	done := make(chan []adapter.ModelMeta, 1)
	go func() { done <- mgr.Harnesses(context.Background())[0].Models }()

	select {
	case got := <-done:
		if len(got) != 1 || got[0].ID != "fallback" {
			t.Fatalf("models = %v, want the adapter's fallback list", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Harnesses blocked on a live model listing")
	}
	close(fa.listGate)
}

// Once the background listing lands, clients are told — a picker opened after
// connecting must show the live catalogue, not the fallback forever.
func TestLiveModelsReplaceTheFallbackAndNotify(t *testing.T) {
	fa := &fakeAdapter{live: []adapter.ModelMeta{
		{ID: "live-default", Label: "Live", Default: true},
		{ID: "live-old", Label: "Old", Group: adapter.GroupLegacy},
	}}
	mgr := modelsTestManager(t, fa)

	id, ch := mgr.SubscribeHarnesses()
	defer mgr.UnsubscribeHarnesses(id)

	mgr.Harnesses(context.Background()) // kicks the refresh

	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatal("a landed model listing never reached subscribers")
	}

	h := mgr.Harnesses(context.Background())[0]
	if len(h.Models) != 2 || h.Models[0].ID != "live-default" {
		t.Fatalf("harness models = %v, want the live list", h.Models)
	}
	if len(h.Instances) != 1 || len(h.Instances[0].Models) != 2 {
		t.Fatalf("instance models = %v, want the live list per instance", h.Instances)
	}
}

// A harness that cannot answer must not be re-asked on every listing: the
// failure is cached, and the fallback keeps the picker populated.
func TestFailedListingIsNotRetriedEveryListing(t *testing.T) {
	fa := &fakeAdapter{liveErr: errors.New("no")}
	mgr := modelsTestManager(t, fa)

	for i := 0; i < 5; i++ {
		h := mgr.Harnesses(context.Background())[0]
		if len(h.Models) == 0 || h.Models[0].ID != "fallback" {
			t.Fatalf("models = %v, want the fallback after a failed listing", h.Models)
		}
		time.Sleep(20 * time.Millisecond)
	}

	fa.mu.Lock()
	calls := fa.listCalls
	fa.mu.Unlock()
	if calls != 1 {
		t.Fatalf("listing attempts = %d, want exactly one until the cache expires", calls)
	}
}

// A recheck is a user saying "I just installed something": it re-asks for
// models as well as readiness.
func TestRecheckDropsCachedModels(t *testing.T) {
	fa := &fakeAdapter{liveErr: errors.New("no")}
	mgr := modelsTestManager(t, fa)

	mgr.Harnesses(context.Background())
	waitForListing(t, fa, 1)

	mgr.RecheckHarnesses()
	mgr.Harnesses(context.Background())
	waitForListing(t, fa, 2)
}

func waitForListing(t *testing.T, fa *fakeAdapter, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		fa.mu.Lock()
		got := fa.listCalls
		fa.mu.Unlock()
		if got >= want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("listing attempts never reached %d", want)
}
