package session

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/asiraky/hy/internal/adapter"
	"github.com/asiraky/hy/internal/proto"
	"github.com/asiraky/hy/internal/store"
)

// Manager owns the set of live actors and the adapter registry.
type Manager struct {
	store    *store.Store
	adapters map[string]adapter.Adapter
	order    []string
	logf     func(string, ...any)

	mu     sync.RWMutex
	actors map[string]*Actor
	// lifecycle serialises resume, close, and delete for a session. Without it,
	// Close could remove an actor before it had marked the row closed and a
	// concurrent Get could spawn a second writer in that window.
	lifecycle sync.Mutex

	probeMu sync.Mutex
	probes  map[string]probeResult

	// Broadcast of session-list changes, so presenters can refresh the sidebar.
	listMu  sync.Mutex
	listSub map[string]chan struct{}
}

// probeTTL bounds how stale a readiness answer may be.
const probeTTL = 30 * time.Second

type probeResult struct {
	result adapter.Availability
	at     time.Time
}

func NewManager(st *store.Store, logf func(string, ...any), ads ...adapter.Adapter) *Manager {
	m := &Manager{
		store:    st,
		adapters: map[string]adapter.Adapter{},
		logf:     logf,
		actors:   map[string]*Actor{},
		probes:   map[string]probeResult{},
		listSub:  map[string]chan struct{}{},
	}
	for _, ad := range ads {
		m.adapters[ad.ID()] = ad
		m.order = append(m.order, ad.ID())
	}
	return m
}

// Harness is one registered harness plus its current readiness, as presented
// to a UI. Everything here comes from the adapter; the core adds nothing and
// interprets nothing.
type Harness struct {
	adapter.HarnessMeta
	Models       []adapter.ModelMeta  `json:"models"`
	Availability adapter.Availability `json:"availability"`
}

// Harnesses lists every registered harness, available or not. An unavailable
// harness is listed with the reason it cannot start, because a silently
// missing harness reads as a bug.
func (m *Manager) Harnesses(ctx context.Context) []Harness {
	out := make([]Harness, 0, len(m.order))
	for _, id := range m.order {
		ad := m.adapters[id]
		out = append(out, Harness{
			HarnessMeta:  ad.Meta(),
			Models:       ad.Models(),
			Availability: m.availability(ctx, ad),
		})
	}
	return out
}

// availability caches a probe result briefly, so that listing harnesses on
// every connection does not re-run process lookups, while a user who installs
// a harness still sees it appear without restarting.
func (m *Manager) availability(ctx context.Context, ad adapter.Adapter) adapter.Availability {
	m.probeMu.Lock()
	cached, ok := m.probes[ad.ID()]
	m.probeMu.Unlock()
	if ok && time.Since(cached.at) < probeTTL {
		return cached.result
	}

	result := ad.Probe(ctx)

	m.probeMu.Lock()
	m.probes[ad.ID()] = probeResult{result: result, at: time.Now()}
	m.probeMu.Unlock()
	return result
}

// RecheckHarnesses drops cached probes so the next listing re-examines the
// system. A UI calls this after telling the user to install something.
func (m *Manager) RecheckHarnesses() {
	m.probeMu.Lock()
	m.probes = map[string]probeResult{}
	m.probeMu.Unlock()
	m.notifyList()
}

// Create starts a new session on the named harness.
func (m *Manager) Create(ctx context.Context, harness, cwd, model, mode string) (*Actor, error) {
	ad, ok := m.adapters[harness]
	if !ok {
		return nil, fmt.Errorf("unknown harness %q", harness)
	}

	// Probe fresh here rather than trusting the cache: the answer decides
	// whether we are about to spawn a process, and it may have changed.
	if avail := ad.Probe(ctx); !avail.OK() {
		m.probeMu.Lock()
		m.probes[ad.ID()] = probeResult{result: avail, at: time.Now()}
		m.probeMu.Unlock()
		return nil, fmt.Errorf("%s is not available: %s", ad.Meta().Name, avail.Reason)
	}

	meta := store.SessionMeta{
		ID:        uuid.NewString(),
		Cwd:       cwd,
		Harness:   harness,
		CreatedAt: proto.NowMillis(),
		UpdatedAt: proto.NowMillis(),
		Phase:     "idle",
	}
	if err := m.store.CreateSession(ctx, meta); err != nil {
		return nil, err
	}

	a, err := Start(ctx, m.store, ad, meta, model, mode, m.logf)
	if err != nil {
		_ = m.store.DeleteSession(ctx, meta.ID)
		return nil, err
	}

	m.adopt(a)
	m.notifyList()

	return a, nil
}

// Get returns the live actor for a session, resuming it from the log if the
// process was restarted since it was last used.
func (m *Manager) Get(ctx context.Context, id string) (*Actor, error) {
	m.lifecycle.Lock()
	defer m.lifecycle.Unlock()

	m.mu.RLock()
	a, ok := m.actors[id]
	m.mu.RUnlock()
	if ok {
		return a, nil
	}

	meta, err := m.store.Session(ctx, id)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	if a, ok := m.actors[id]; ok { // another caller won the race
		m.mu.Unlock()
		return a, nil
	}
	m.mu.Unlock()

	if meta.Phase == "closed" {
		a, err = RestoreClosed(ctx, m.store, meta, m.logf)
	} else {
		ad, ok := m.adapters[meta.Harness]
		if !ok {
			return nil, fmt.Errorf("unknown harness %q", meta.Harness)
		}
		a, err = Resume(ctx, m.store, ad, meta, m.logf)
	}
	if err != nil {
		return nil, err
	}
	m.adopt(a)
	return a, nil
}

// Peek returns the live actor if one exists, without starting a harness.
func (m *Manager) Peek(id string) (*Actor, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	a, ok := m.actors[id]
	return a, ok
}

// adopt registers a live actor and arranges for it to be forgotten when its
// harness exits, so the next attach resumes the session cleanly.
func (m *Manager) adopt(a *Actor) {
	m.mu.Lock()
	m.actors[a.ID] = a
	m.mu.Unlock()
	a.mu.Lock()
	a.onExit = m.forgetFn(a.ID, a)
	a.onPhase = m.notifyList
	a.mu.Unlock()
	select {
	case <-a.quit:
		m.mu.Lock()
		if m.actors[a.ID] == a {
			delete(m.actors, a.ID)
		}
		m.mu.Unlock()
	default:
	}
}

func (m *Manager) forgetFn(id string, a *Actor) func() {
	return func() {
		m.mu.Lock()
		if cur, ok := m.actors[id]; ok && cur == a {
			delete(m.actors, id)
		}
		m.mu.Unlock()
		m.notifyList()
	}
}

func (m *Manager) List(ctx context.Context) ([]store.SessionMeta, error) {
	return m.store.ListSessions(ctx)
}

// Close disposes a session's harness. The log is untouched.
func (m *Manager) Close(ctx context.Context, id, reason string) error {
	m.lifecycle.Lock()
	defer m.lifecycle.Unlock()
	return m.closeLocked(ctx, id, reason)
}

func (m *Manager) closeLocked(ctx context.Context, id, reason string) error {
	meta, err := m.store.Session(ctx, id)
	if err != nil {
		return err
	}
	m.mu.Lock()
	a, ok := m.actors[id]
	delete(m.actors, id)
	m.mu.Unlock()
	if ok {
		if meta.Phase == "closed" {
			a.Dispose(reason)
		} else {
			a.Close(reason)
		}
	} else {
		if meta.Phase != "closed" {
			if _, err := m.store.Append(ctx, id, proto.Emit(proto.SessionClosed, proto.SessionClosedPayload{Reason: reason})); err != nil {
				return err
			}
			if err := m.store.SetPhase(ctx, id, "closed"); err != nil {
				return err
			}
		}
	}
	m.notifyList()
	return nil
}

// Delete removes a session and its log entirely.
func (m *Manager) Delete(ctx context.Context, id string) error {
	m.lifecycle.Lock()
	defer m.lifecycle.Unlock()
	if err := m.closeLocked(ctx, id, "deleted"); err != nil {
		return err
	}
	if err := m.store.DeleteSession(ctx, id); err != nil {
		return err
	}
	m.notifyList()
	return nil
}

// Shutdown tears down every harness process. Sessions are left resumable: the
// log is the session, and a restart reattaches to it.
func (m *Manager) Shutdown() {
	m.lifecycle.Lock()
	defer m.lifecycle.Unlock()
	m.mu.Lock()
	actors := m.actors
	m.actors = map[string]*Actor{}
	m.mu.Unlock()
	for _, a := range actors {
		a.Dispose("server shutdown")
	}
}

// ---- session-list change notifications ----

func (m *Manager) SubscribeList() (string, chan struct{}) {
	id := uuid.NewString()
	ch := make(chan struct{}, 1)
	m.listMu.Lock()
	m.listSub[id] = ch
	m.listMu.Unlock()
	return id, ch
}

func (m *Manager) UnsubscribeList(id string) {
	m.listMu.Lock()
	delete(m.listSub, id)
	m.listMu.Unlock()
}

// NotifyList wakes every list subscriber; used after a title or phase change.
func (m *Manager) NotifyList() { m.notifyList() }

func (m *Manager) notifyList() {
	m.listMu.Lock()
	defer m.listMu.Unlock()
	for _, ch := range m.listSub {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}
