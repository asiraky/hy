package session

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/asiraky/hy/internal/adapter"
	"github.com/asiraky/hy/internal/project"
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

type CreateProjectOptions struct {
	ProjectID string
	Harness   string
	Model     string
	Mode      string
	Effort    string
	Branch    string
	Workspace string
	// WorkspacePath attaches the session to a checkout that already exists
	// instead of provisioning one. It is the minority case, so it overrides
	// Workspace rather than being another value of it.
	WorkspacePath string
}

// CreateProject persists and returns an attachable session immediately. Its
// workspace is prepared in the background; no harness exists before readiness.
func (m *Manager) CreateProject(ctx context.Context, o CreateProjectOptions) (*Actor, error) {
	p, err := m.store.Project(ctx, o.ProjectID)
	if err != nil {
		return nil, err
	}
	if o.Harness == "" {
		o.Harness = p.Config.Defaults.Harness
	}
	if o.Model == "" {
		o.Model = p.Config.Defaults.Model
	}
	if o.Mode == "" {
		o.Mode = p.Config.Defaults.Mode
	}
	if o.Effort == "" {
		o.Effort = p.Config.Defaults.Effort
	}
	if o.Workspace == "" {
		o.Workspace = p.Config.Defaults.Workspace
	}
	if o.Workspace == "" {
		o.Workspace = "local"
	}
	ad, ok := m.adapters[o.Harness]
	if !ok {
		return nil, fmt.Errorf("unknown harness %q", o.Harness)
	}
	if avail := ad.Probe(ctx); !avail.OK() {
		return nil, fmt.Errorf("%s is not available: %s", ad.Meta().Name, avail.Reason)
	}
	provision, err := project.ResolveHook(p.Root, p.Config.Workspace.Provision)
	if err != nil && p.Config.Workspace.Provision != "" {
		return nil, fmt.Errorf("provision hook: %w", err)
	}
	deprovision, err := project.ResolveHook(p.Root, p.Config.Workspace.Deprovision)
	if err != nil && p.Config.Workspace.Deprovision != "" {
		return nil, fmt.Errorf("deprovision hook: %w", err)
	}
	cwd := p.Root
	if strings.TrimSpace(o.WorkspacePath) != "" {
		w, resolveErr := m.ResolveWorkspace(ctx, p.ID, o.WorkspacePath)
		if resolveErr != nil {
			return nil, resolveErr
		}
		// hy did not create this checkout, so it must never destroy it: the
		// borrowed mode skips both hooks and the managed worktree teardown.
		cwd, o.Workspace, provision, deprovision = w.Path, "borrowed", "", ""
		if o.Branch == "" {
			o.Branch = w.Branch
		}
	}

	meta := store.SessionMeta{ID: uuid.NewString(), Cwd: cwd, Harness: o.Harness, CreatedAt: proto.NowMillis(), UpdatedAt: proto.NowMillis(), Phase: "creating", ProjectID: p.ID, Branch: o.Branch, Model: o.Model, Mode: o.Mode, Effort: o.Effort, WorkspaceMode: o.Workspace, ProvisionScript: relHook(p.Root, provision), DeprovisionScript: relHook(p.Root, deprovision)}
	if err := m.store.CreateSession(ctx, meta); err != nil {
		return nil, err
	}
	a := StartPending(m.store, ad, meta, m.logf)
	m.adopt(a)
	m.notifyList()
	go m.provision(meta, p, a)
	return a, nil
}

func relHook(root, path string) string {
	if path == "" {
		return ""
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return ""
	}
	return rel
}

func (m *Manager) AddProject(ctx context.Context, root string) (project.Project, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return project.Project{}, err
	}
	cfg, err := project.Load(abs)
	if err != nil {
		return project.Project{}, err
	}
	now := proto.NowMillis()
	p := project.Project{ID: uuid.NewString(), Root: abs, Config: cfg, CreatedAt: now, UpdatedAt: now}
	if err := m.store.PutProject(ctx, p); err != nil {
		return p, err
	}
	m.notifyList()
	return p, nil
}

func (m *Manager) SaveProject(ctx context.Context, id string, cfg project.Config) (project.Project, error) {
	p, err := m.store.Project(ctx, id)
	if err != nil {
		return p, err
	}
	cfg, err = project.Save(p.Root, cfg)
	if err != nil {
		return p, err
	}
	p.Config = cfg
	p.UpdatedAt = proto.NowMillis()
	if err := m.store.PutProject(ctx, p); err != nil {
		return p, err
	}
	m.notifyList()
	return p, nil
}

// ReloadProjects re-reads each project's on-disk config, which is the source
// of truth; the copy in the database is a cache that a pull can make stale. A
// project whose file has gone is left as it is: a missing file means the
// checkout moved or is mid-checkout, not that its settings were cleared.
func (m *Manager) ReloadProjects(ctx context.Context) error {
	projects, err := m.store.ListProjects(ctx)
	if err != nil {
		return err
	}
	changed := false
	for _, p := range projects {
		if _, statErr := os.Stat(filepath.Join(p.Root, project.ConfigPath)); statErr != nil {
			continue
		}
		cfg, loadErr := project.Load(p.Root)
		if loadErr != nil {
			m.logf("project %s: %v", p.Config.Name, loadErr)
			continue
		}
		if reflect.DeepEqual(cfg, p.Config) {
			continue
		}
		p.Config, p.UpdatedAt = cfg, proto.NowMillis()
		if err := m.store.PutProject(ctx, p); err != nil {
			return err
		}
		changed = true
	}
	if changed {
		m.notifyList()
	}
	return nil
}

func (m *Manager) Projects(ctx context.Context) ([]project.Project, error) {
	return m.store.ListProjects(ctx)
}

func (m *Manager) RetryProvision(ctx context.Context, id string) error {
	a, ok := m.Peek(id)
	if !ok {
		var err error
		a, err = m.Get(ctx, id)
		if err != nil {
			return err
		}
	}
	m.lifecycle.Lock()
	defer m.lifecycle.Unlock()
	meta, err := m.store.Session(ctx, id)
	if err != nil {
		return err
	}
	if meta.Phase != "provision_failed" {
		return fmt.Errorf("session is not awaiting provisioning")
	}
	p, err := m.store.Project(ctx, meta.ProjectID)
	if err != nil {
		return err
	}
	if err := m.store.SetPhase(ctx, id, "provisioning"); err != nil {
		return err
	}
	go m.provision(meta, p, a)
	return nil
}

func (m *Manager) Cleanup(ctx context.Context, id string) error {
	m.lifecycle.Lock()
	defer m.lifecycle.Unlock()
	meta, err := m.store.Session(ctx, id)
	if err != nil {
		return err
	}
	if meta.ProjectID == "" {
		return m.closeLocked(ctx, id, "closed by user")
	}
	if meta.Phase == "cleaning" {
		return errors.New("workspace cleanup is already running")
	}
	if meta.Phase == "closed" {
		return nil
	}
	p, err := m.store.Project(ctx, meta.ProjectID)
	if err != nil {
		return err
	}
	// Stop the harness first. A fresh, process-less actor keeps cleanup output attachable.
	if live, ok := m.Peek(id); ok {
		live.Dispose("cleaning workspace")
	}
	_ = m.store.SetPhase(ctx, id, "cleaning")
	ad, ok := m.adapters[meta.Harness]
	if !ok {
		return fmt.Errorf("unknown harness %q", meta.Harness)
	}
	a, err := RestorePending(ctx, m.store, ad, meta, m.logf)
	if err != nil {
		return err
	}
	m.adopt(a)
	go m.cleanup(meta, p, a, false)
	return nil
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
	} else if meta.Phase == "creating" || meta.Phase == "provisioning" || meta.Phase == "provision_failed" || meta.Phase == "cleaning" || meta.Phase == "cleanup_failed" {
		ad, ok := m.adapters[meta.Harness]
		if !ok {
			return nil, fmt.Errorf("unknown harness %q", meta.Harness)
		}
		a, err = RestorePending(ctx, m.store, ad, meta, m.logf)
		if err == nil && (meta.Phase == "creating" || meta.Phase == "provisioning") {
			_ = m.store.SetPhase(ctx, meta.ID, "provision_failed")
			_ = a.Emit(ctx, proto.Emit(proto.WorkspaceFailed, proto.WorkspaceFailedPayload{Hook: "provision", Error: "server restarted while provisioning; retry is safe"}))
		}
		if err == nil && meta.Phase == "cleaning" {
			_ = m.store.SetPhase(ctx, meta.ID, "cleanup_failed")
			_ = a.Emit(ctx, proto.Emit(proto.WorkspaceCleanupFailed, proto.WorkspaceFailedPayload{Hook: "deprovision", Error: "server restarted while cleaning up; retry is safe"}))
		}
		if err == nil {
			m.notifyList()
		}
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

	// A session resumed from a turn the server died in the middle of carries
	// on by itself. Off the lifecycle lock and off this goroutine: the prompt
	// reaches a harness that has just started, and nothing else — including
	// the attach that triggered this — should wait behind it.
	go func() {
		if err := a.Recover(context.Background()); err != nil {
			m.logf("continue interrupted turn on %s: %v", a.ID, err)
		}
	}()
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
	meta, err := m.store.Session(ctx, id)
	if err != nil {
		return err
	}
	if meta.Phase == "closed" {
		if err := m.store.DeleteSession(ctx, id); err != nil {
			return err
		}
		m.notifyList()
		return nil
	}
	if meta.ProjectID == "" {
		if err := m.closeLocked(ctx, id, "deleted"); err != nil {
			return err
		}
		if err := m.store.DeleteSession(ctx, id); err != nil {
			return err
		}
		m.notifyList()
		return nil
	}
	if meta.Phase == "cleaning" {
		return errors.New("workspace cleanup is already running")
	}
	p, err := m.store.Project(ctx, meta.ProjectID)
	if err != nil {
		return err
	}
	if live, ok := m.Peek(id); ok {
		live.Dispose("deleting session")
	}
	if err := m.store.SetPhase(ctx, id, "cleaning"); err != nil {
		return err
	}
	ad, ok := m.adapters[meta.Harness]
	if !ok {
		return fmt.Errorf("unknown harness %q", meta.Harness)
	}
	a, err := RestorePending(ctx, m.store, ad, meta, m.logf)
	if err != nil {
		return err
	}
	m.adopt(a)
	go m.cleanup(meta, p, a, true)
	return nil
}

// ForceDelete skips the project deprovision hook after it has failed. It only
// removes the exact recorded Git worktree, prunes Git metadata, then purges the
// transcript. The project root is never removed.
func (m *Manager) ForceDelete(ctx context.Context, id string) error {
	m.lifecycle.Lock()
	defer m.lifecycle.Unlock()
	meta, err := m.store.Session(ctx, id)
	if err != nil {
		return err
	}
	if meta.Phase != "cleanup_failed" {
		return errors.New("force delete is only available after teardown fails")
	}
	p, err := m.store.Project(ctx, meta.ProjectID)
	if err != nil {
		return err
	}
	// A borrowed checkout belongs to whoever made it; forcing the session away
	// must not take their worktree with it.
	if meta.WorkspaceMode != "borrowed" {
		if err := m.removeGitWorktree(ctx, meta, p, nil, true); err != nil {
			return err
		}
	}
	if live, ok := m.Peek(id); ok {
		live.Dispose("force deleted")
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
