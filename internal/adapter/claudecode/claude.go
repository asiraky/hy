// Package claudecode adapts Anthropic's Claude Agent SDK to the canonical
// event model.
//
// The SDK is a TypeScript/Python library, so it is hosted in a small Node
// sidecar (see sidecar/sidecar.mjs) which this package spawns and speaks to
// over stdio. Everything that arrangement implies — locating a JS runtime,
// unpacking the bridge, finding the user's Claude Code install, process
// lifecycle — is contained in this package. Nothing outside it knows a sidecar
// exists.
package claudecode

import (
	"bufio"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/google/uuid"

	"github.com/asiraky/hy/internal/adapter"
	"github.com/asiraky/hy/internal/jsonrpc"
	"github.com/asiraky/hy/internal/proto"
)

//go:embed sidecar/sidecar.mjs sidecar/guard.mjs sidecar/package.json
var sidecarFS embed.FS

// Adapter creates Claude sessions.
type Adapter struct {
	// ClaudePath optionally pins the Claude Code executable. Empty means
	// discover it.
	ClaudePath string

	// bundledSidecar is a standalone sidecar executable compiled into this
	// build, used when the host has no JS runtime. Empty in slim builds.
	bundledSidecar string

	once      sync.Once
	unpacked  string
	unpackErr error
}

func New(claudePath string) *Adapter {
	return &Adapter{ClaudePath: claudePath, bundledSidecar: bundledSidecarPath()}
}

func (a *Adapter) ID() string { return "claude" }

func (a *Adapter) Meta() adapter.HarnessMeta {
	return adapter.HarnessMeta{
		ID:      "claude",
		Name:    "Claude Code",
		Accent:  "oklch(0.72 0.13 48)",
		DocsURL: docsURL,
	}
}

func (a *Adapter) Models() []adapter.ModelMeta {
	return []adapter.ModelMeta{
		{ID: "", Label: "Default"},
		{ID: "fable", Label: "Fable"},
		{ID: "opus", Label: "Opus"},
		{ID: "sonnet", Label: "Sonnet"},
		{ID: "haiku", Label: "Haiku"},
	}
}

// PermissionModes are the Agent SDK's PermissionMode values, verbatim: the id
// is what the sidecar passes as `permissionMode`. The SDK spells the manual
// mode `default` (the CLI alias `manual` is CLI-only), and it is what hy sends.
func (a *Adapter) PermissionModes() []adapter.PermissionModeMeta {
	return []adapter.PermissionModeMeta{
		{ID: "default", Label: "Manual", Description: "Ask before every edit, command, and network call", Default: true},
		{ID: "plan", Label: "Plan", Description: "Read and analyze only; no changes"},
		{ID: "acceptEdits", Label: "Accept edits", Description: "Auto-accept file edits; still ask for commands"},
		{ID: "auto", Label: "Auto", Description: "A classifier approves routine actions; ask on risk"},
		{ID: "dontAsk", Label: "Pre-approved only", Description: "Never prompt; deny anything not already allowed"},
		{ID: "bypassPermissions", Label: "Bypass", Description: "Skip all permission checks", Danger: true},
	}
}

// Probe reports whether a Claude session could start right now. Discovery of
// the runtime and the Claude Code install is machine-level, not per-account,
// so the instance env does not change the answer today; it is accepted so a
// future credential check can be per instance.
func (a *Adapter) Probe(ctx context.Context, env map[string]string) adapter.Availability {
	_, avail := a.resolve(ctx)
	return avail
}

// sidecarPath unpacks the bridge next to the user's cache once per process and
// returns its directory.
func (a *Adapter) sidecarPath() (string, error) {
	a.once.Do(func() {
		// A source build should use the checked-out bridge. The root npm
		// workspace installs its SDK dependency, and Node can resolve a hoisted
		// package from any parent node_modules directory. Distribution binaries
		// fall through to the self-contained cache extraction below.
		if dir := sourceSidecarPath(); dir != "" {
			a.unpacked = dir
			return
		}
		base, err := os.UserCacheDir()
		if err != nil {
			a.unpackErr = err
			return
		}
		dir := filepath.Join(base, "hy", "claude-sidecar")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			a.unpackErr = err
			return
		}
		err = fs.WalkDir(sidecarFS, "sidecar", func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			data, err := sidecarFS.ReadFile(p)
			if err != nil {
				return err
			}
			return os.WriteFile(filepath.Join(dir, filepath.Base(p)), data, 0o644)
		})
		a.unpacked, a.unpackErr = dir, err
	})
	return a.unpacked, a.unpackErr
}

func sourceSidecarPath() string {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return ""
	}
	dir := filepath.Join(filepath.Dir(filename), "sidecar")
	if _, err := os.Stat(filepath.Join(dir, "sidecar.mjs")); err != nil {
		return ""
	}
	if moduleInstalled(dir, "@anthropic-ai", "claude-agent-sdk") {
		return dir
	}
	return ""
}

func moduleInstalled(dir string, parts ...string) bool {
	for parent := dir; ; parent = filepath.Dir(parent) {
		candidate := append([]string{parent, "node_modules"}, parts...)
		if _, err := os.Stat(filepath.Join(candidate...)); err == nil {
			return true
		}
		next := filepath.Dir(parent)
		if next == parent {
			return false
		}
	}
}

// sidecarConfig is what the bridge needs to start a session. It is passed as
// one JSON argument so the sidecar has no bespoke flag parsing.
type sidecarConfig struct {
	Cwd            string `json:"cwd"`
	Model          string `json:"model,omitempty"`
	PermissionMode string `json:"permissionMode,omitempty"`
	// AllowDangerouslySkipPermissions is the SDK's second opt-in: without it,
	// bypassPermissions is rejected both at start and on a later
	// setPermissionMode. It permits the mode; it does not enable it.
	AllowDangerouslySkipPermissions bool   `json:"allowDangerouslySkipPermissions,omitempty"`
	Effort                          string `json:"effort,omitempty"`
	// SessionID and Resume are mutually exclusive, as the SDK requires: one
	// names a new conversation, the other continues an existing one.
	SessionID  string `json:"sessionId,omitempty"`
	Resume     string `json:"resume,omitempty"`
	ClaudePath string `json:"claudePath,omitempty"`
}

func (a *Adapter) CreateSession(ctx context.Context, host adapter.HostServices, o adapter.CreateOptions) (adapter.Session, error) {
	r, avail := a.resolve(ctx)
	if !avail.OK() {
		return nil, fmt.Errorf("claude is unavailable: %s", avail.Reason)
	}

	// We own session identity: the same id starts a session and later resumes
	// it, so a server restart continues the conversation rather than starting
	// blank.
	sessionID := o.SessionID
	if sessionID == "" {
		sessionID = uuid.NewString()
	}

	cfg := sidecarConfig{
		Cwd:            o.Cwd,
		Model:          o.Model,
		PermissionMode: o.Mode,
		// Always allowed as an *option* (the CLI's
		// --allow-dangerously-skip-permissions semantics), never enabled by it:
		// the SDK rejects bypassPermissions — at start or via a mid-session
		// setPermissionMode — unless this was set at launch. hy's own gate is
		// the confirmation the UI requires before any danger mode.
		AllowDangerouslySkipPermissions: true,
		Effort:                          o.Effort,
		ClaudePath:                      r.claudePath,
	}
	// We own session identity: the same id names the conversation on create
	// and resumes it later, so a server restart continues rather than starting
	// blank. The SDK rejects both fields together.
	if o.Resume {
		cfg.Resume = sessionID
	} else {
		cfg.SessionID = sessionID
	}
	blob, err := json.Marshal(cfg)
	if err != nil {
		return nil, err
	}

	args := append(append([]string{}, r.runtimeArgs...), string(blob))
	cmd := exec.Command(r.runtime, args...)
	cmd.Dir = o.Cwd
	// The instance's overlay over the ambient environment is the entire
	// credential mechanism: CLAUDE_CONFIG_DIR, CLAUDE_CODE_OAUTH_TOKEN, or
	// ANTHROPIC_API_KEY select the account per process.
	cmd.Env = append(adapter.MergeEnv(os.Environ(), o.Env), "CLAUDE_CODE_ENTRYPOINT=sdk-ts")

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start claude bridge: %w", err)
	}

	s := &session{
		host:             host,
		cmd:              cmd,
		stdin:            stdin,
		harnessSessionID: sessionID,
		events:           make(chan proto.Emission, 256),
		blocks:           map[int]*block{},
		done:             make(chan struct{}),
	}
	s.conn = jsonrpc.NewConn(stdout, stdin, s.handleRequest, s.handleNotification)

	go s.drainStderr(stderr)
	go s.watchExit()

	s.emit(proto.Emit(proto.SessionConfigChanged, proto.SessionConfigChangedPayload{
		HarnessSessionID: sessionID,
	}))

	return s, nil
}

// block tracks one streaming content block of the current assistant message.
type block struct {
	kind    string // text | thinking | tool_use
	blockID string
	toolID  string
	name    string
}

type session struct {
	host  adapter.HostServices
	cmd   *exec.Cmd
	conn  *jsonrpc.Conn
	stdin io.WriteCloser

	harnessSessionID string

	events chan proto.Emission
	done   chan struct{}
	closed sync.Once

	mu        sync.Mutex
	turnID    string
	messageID string
	blocks    map[int]*block
	sawResult bool
	model     string
}

func (s *session) Events() <-chan proto.Emission { return s.events }

func (s *session) Prompt(ctx context.Context, in adapter.PromptInput) error {
	s.mu.Lock()
	// The actor believed the session was idle when it accepted this prompt,
	// but the harness may have started work by itself in the meantime — the
	// turn it opened is queued on the event channel and the actor has not
	// seen it yet. Overwriting that turn's id here would label the harness's
	// in-flight work with this prompt's turn and leave the open turn
	// unfinished forever. Refuse instead; the caller can retry when idle.
	if s.turnID != "" && s.turnID != in.TurnID {
		s.mu.Unlock()
		return errors.New("the harness resumed work on its own; wait for it to finish")
	}
	s.turnID = in.TurnID
	s.sawResult = false
	s.mu.Unlock()

	return s.conn.Notify("prompt", map[string]any{"text": in.Text})
}

func (s *session) Cancel(ctx context.Context) error {
	return s.conn.Notify("interrupt", map[string]any{})
}

// SetMode switches the permission mode mid-session via the SDK's
// setPermissionMode, which needs no restart in streaming input mode. It is a
// request, not a notification, so a mode the harness refuses (managed settings
// can disable bypass and auto) comes back as a legible error.
func (s *session) SetMode(ctx context.Context, mode string) error {
	return s.conn.Call(ctx, "setPermissionMode", map[string]any{"mode": mode}, nil)
}

// SetModel switches the model mid-session via the SDK's setModel. The sidecar
// treats it as a notification; the change is confirmed by the next system/init
// or simply applies to the next request.
func (s *session) SetModel(ctx context.Context, model string) error {
	s.mu.Lock()
	s.model = model
	s.mu.Unlock()
	return s.conn.Notify("setModel", map[string]any{"model": model})
}

// Close tears down the bridge. Closing stdin is the primary signal: the
// sidecar watches for EOF and exits, taking Claude Code with it. The kill is
// a backstop for a wedged process.
func (s *session) Close() error {
	s.closed.Do(func() {
		close(s.done)
		_ = s.stdin.Close()
		if s.cmd.Process != nil {
			_ = s.cmd.Process.Kill()
		}
		_ = s.cmd.Wait()
	})
	return nil
}

func (s *session) watchExit() {
	<-s.conn.Done()

	s.mu.Lock()
	turn, saw := s.turnID, s.sawResult
	s.turnID = ""
	s.mu.Unlock()

	if turn != "" && !saw {
		s.emit(proto.Emit(proto.TurnFinished, proto.TurnFinishedPayload{
			TurnID: turn, StopReason: proto.StopError, Error: "claude bridge exited",
		}))
	}
	close(s.events)
}

func (s *session) drainStderr(r io.ReadCloser) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		if line := strings.TrimSpace(sc.Text()); line != "" {
			s.host.Logf("claude bridge: %s", line)
		}
	}
}

func (s *session) emit(e proto.Emission) {
	select {
	case s.events <- e:
	case <-s.done:
	}
}

func (s *session) currentTurn() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.turnID
}

// ensureTurn returns the active turn id, opening a harness-initiated turn if
// none is open. The SDK can resume work without being prompted — a background
// task completing, an auto-continuation — and that work is a real turn: it
// needs an id so its events can be grouped, and a turn.started so projections
// know the session is no longer idle. A turn opened here has no prompt; that
// is what marks it as the harness's own doing.
func (s *session) ensureTurn() string {
	s.mu.Lock()
	if s.turnID != "" {
		id := s.turnID
		s.mu.Unlock()
		return id
	}
	id := uuid.NewString()
	s.turnID = id
	s.sawResult = false
	s.mu.Unlock()

	s.emit(proto.Emit(proto.TurnStarted, proto.TurnStartedPayload{TurnID: id}))
	return id
}

// handleRequest services the bridge's only inbound request: a permission
// decision, which the host routes to a human and answers from any presenter.
func (s *session) handleRequest(ctx context.Context, method string, params json.RawMessage) (any, error) {
	if method != "permission" {
		return nil, fmt.Errorf("unsupported request: %s", method)
	}

	var p struct {
		ToolName string          `json:"toolName"`
		Input    json.RawMessage `json:"input"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, err
	}

	outcome, err := s.host.RequestPermission(ctx, adapter.PermissionRequest{
		TurnID:   s.currentTurn(),
		ToolName: p.ToolName,
		Title:    toolTitle(p.ToolName, p.Input),
		RawInput: p.Input,
		Options:  proto.DefaultPermissionOptions(),
	})
	if err != nil {
		return map[string]any{"behavior": "deny", "message": "permission unavailable: " + err.Error()}, nil
	}
	if outcome.Allowed() {
		return map[string]any{"behavior": "allow", "updatedInput": p.Input}, nil
	}
	return map[string]any{"behavior": "deny", "message": "Denied by user"}, nil
}

func (s *session) handleNotification(method string, params json.RawMessage) {
	switch method {
	case "message":
		var p struct {
			Message map[string]json.RawMessage `json:"message"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return
		}
		s.handleSDKMessage(p.Message)

	case "fatal":
		var p struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(params, &p)
		if p.Message != "session ended" {
			s.host.Logf("claude bridge fatal: %s", p.Message)
		}
	}
}

// handleSDKMessage maps one Agent SDK message onto canonical events. This is
// the only mapping in the system, and it is the reason the sidecar stays dumb.
func (s *session) handleSDKMessage(msg map[string]json.RawMessage) {
	switch str(msg["type"]) {
	case "system":
		s.handleSystem(msg)
	case "stream_event":
		s.handleStreamEvent(msg)
	case "assistant":
		s.handleAssistant(msg)
	case "user":
		s.handleUser(msg)
	case "result":
		s.handleResult(msg)
	}
}

// contextWindowFor is a heuristic: the SDK does not report the window, so the
// indicator assumes the standard 200k unless the model id opts into the 1M
// beta. Close enough for a gauge that only has three colours.
func contextWindowFor(model string) int64 {
	if strings.Contains(model, "[1m]") {
		return 1_000_000
	}
	return 200_000
}

func (s *session) handleSystem(msg map[string]json.RawMessage) {
	if str(msg["subtype"]) != "init" {
		return
	}
	var init struct {
		Model          string `json:"model"`
		PermissionMode string `json:"permissionMode"`
	}
	remarshal(msg, &init)
	s.mu.Lock()
	s.model = init.Model
	s.mu.Unlock()
	s.emit(proto.Emit(proto.SessionConfigChanged, proto.SessionConfigChangedPayload{
		Model: init.Model, Mode: init.PermissionMode, HarnessSessionID: s.harnessSessionID,
	}))
}

type streamEvent struct {
	Type    string `json:"type"`
	Index   int    `json:"index"`
	Message struct {
		ID string `json:"id"`
	} `json:"message"`
	ContentBlock struct {
		Type string `json:"type"`
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"content_block"`
	Delta struct {
		Type     string `json:"type"`
		Text     string `json:"text"`
		Thinking string `json:"thinking"`
	} `json:"delta"`
}

func (s *session) handleStreamEvent(msg map[string]json.RawMessage) {
	var wrapper struct {
		Event streamEvent `json:"event"`
	}
	remarshal(msg, &wrapper)
	ev := wrapper.Event

	switch ev.Type {
	case "message_start":
		s.mu.Lock()
		s.messageID = ev.Message.ID
		s.blocks = map[int]*block{}
		s.mu.Unlock()

	case "content_block_start":
		// Output is starting. If no turn is open — the harness resumed work
		// by itself, without a prompt — this opens one, so the events below
		// never carry an empty turn id.
		turn := s.ensureTurn()
		s.mu.Lock()
		b := &block{kind: ev.ContentBlock.Type}
		switch ev.ContentBlock.Type {
		case "text", "thinking":
			b.blockID = fmt.Sprintf("%s:%d", s.messageID, ev.Index)
		case "tool_use":
			b.toolID, b.name = ev.ContentBlock.ID, ev.ContentBlock.Name
		}
		s.blocks[ev.Index] = b
		s.mu.Unlock()

		if ev.ContentBlock.Type == "tool_use" {
			s.emit(proto.Emit(proto.ToolCallStarted, proto.ToolCallStartedPayload{
				TurnID:     turn,
				ToolCallID: ev.ContentBlock.ID,
				Kind:       toolKind(ev.ContentBlock.Name),
				Title:      ev.ContentBlock.Name,
				Status:     proto.StatusPending,
			}))
		}

	case "content_block_delta":
		s.mu.Lock()
		b := s.blocks[ev.Index]
		s.mu.Unlock()
		if b == nil {
			return
		}
		turn := s.ensureTurn()
		switch ev.Delta.Type {
		case "text_delta":
			s.emit(proto.Emit(proto.MessageChunk, proto.MessageChunkPayload{
				TurnID: turn, Role: "agent", Kind: "text", BlockID: b.blockID, Delta: ev.Delta.Text,
			}))
		case "thinking_delta":
			s.emit(proto.Emit(proto.MessageChunk, proto.MessageChunkPayload{
				TurnID: turn, Role: "agent", Kind: "thought", BlockID: b.blockID, Delta: ev.Delta.Thinking,
			}))
		}
	}
}

func (s *session) handleAssistant(msg map[string]json.RawMessage) {
	var m struct {
		Message struct {
			Content []struct {
				Type  string          `json:"type"`
				ID    string          `json:"id"`
				Name  string          `json:"name"`
				Input json.RawMessage `json:"input"`
			} `json:"content"`
		} `json:"message"`
	}
	remarshal(msg, &m)

	for _, c := range m.Message.Content {
		if c.Type != "tool_use" {
			continue
		}
		s.emit(proto.Emit(proto.ToolCallUpdated, proto.ToolCallUpdatedPayload{
			ToolCallID: c.ID,
			Status:     proto.StatusInProgress,
			Title:      toolTitle(c.Name, c.Input),
			RawInput:   c.Input,
		}))
	}
}

func (s *session) handleUser(msg map[string]json.RawMessage) {
	var m struct {
		Message struct {
			Content []struct {
				Type      string          `json:"type"`
				ToolUseID string          `json:"tool_use_id"`
				IsError   bool            `json:"is_error"`
				Content   json.RawMessage `json:"content"`
			} `json:"content"`
		} `json:"message"`
	}
	remarshal(msg, &m)

	for _, c := range m.Message.Content {
		if c.Type != "tool_result" {
			continue
		}
		status := proto.StatusCompleted
		if c.IsError {
			status = proto.StatusFailed
		}
		var content []proto.ToolContent
		if text := flattenContent(c.Content); text != "" {
			content = []proto.ToolContent{{Type: "text", Text: text}}
		}
		s.emit(proto.Emit(proto.ToolCallUpdated, proto.ToolCallUpdatedPayload{
			ToolCallID: c.ToolUseID, Status: status, Content: content,
		}))
	}
}

func (s *session) handleResult(msg map[string]json.RawMessage) {
	var r struct {
		IsError      bool    `json:"is_error"`
		StopReason   string  `json:"stop_reason"`
		TotalCostUSD float64 `json:"total_cost_usd"`
		Usage        struct {
			InputTokens              int64 `json:"input_tokens"`
			OutputTokens             int64 `json:"output_tokens"`
			CacheReadInputTokens     int64 `json:"cache_read_input_tokens"`
			CacheCreationInputTokens int64 `json:"cache_creation_input_tokens"`
		} `json:"usage"`
	}
	remarshal(msg, &r)

	// The final request's prompt is the conversation so far, so its input
	// (fresh + cached) plus what came back approximates the context in use.
	s.mu.Lock()
	window := contextWindowFor(s.model)
	s.mu.Unlock()
	used := r.Usage.InputTokens + r.Usage.CacheReadInputTokens + r.Usage.CacheCreationInputTokens + r.Usage.OutputTokens
	var pct float64
	if used > 0 && window > 0 {
		pct = min(100, float64(used)/float64(window)*100)
	}

	s.emit(proto.Emit(proto.UsageUpdated, proto.UsageUpdatedPayload{
		Input:      r.Usage.InputTokens,
		Output:     r.Usage.OutputTokens,
		CacheRead:  r.Usage.CacheReadInputTokens,
		CacheWrite: r.Usage.CacheCreationInputTokens,
		Cost:          r.TotalCostUSD,
		ContextPct:    pct,
		ContextUsed:   used,
		ContextWindow: window,
	}))

	stop := r.StopReason
	switch {
	case r.IsError:
		stop = proto.StopError
	case stop == "":
		stop = proto.StopEndTurn
	}

	s.mu.Lock()
	turn := s.turnID
	s.sawResult = true
	s.turnID = ""
	s.mu.Unlock()

	// A result for a turn that was never started — no prompt, and no output
	// that would have opened one — has nothing to finish. Emitting it anyway
	// would put an unmatched turn.finished in the log.
	if turn == "" {
		return
	}

	s.emit(proto.Emit(proto.TurnFinished, proto.TurnFinishedPayload{TurnID: turn, StopReason: stop}))
}

// ---- helpers ----

func str(raw json.RawMessage) string {
	var s string
	_ = json.Unmarshal(raw, &s)
	return s
}

func remarshal(msg map[string]json.RawMessage, out any) {
	b, err := json.Marshal(msg)
	if err != nil {
		return
	}
	_ = json.Unmarshal(b, out)
}

func toolKind(name string) string {
	switch name {
	case "Read", "NotebookRead":
		return proto.KindRead
	case "Edit", "Write", "NotebookEdit", "MultiEdit":
		return proto.KindEdit
	case "Bash", "BashOutput", "KillShell":
		return proto.KindExecute
	case "Grep", "Glob", "Search":
		return proto.KindSearch
	case "WebFetch", "WebSearch":
		return proto.KindFetch
	case "Task", "Agent":
		return proto.KindThink
	default:
		return proto.KindOther
	}
}

func toolTitle(name string, input json.RawMessage) string {
	var in map[string]any
	if len(input) > 0 {
		_ = json.Unmarshal(input, &in)
	}
	pick := func(keys ...string) string {
		for _, k := range keys {
			if v, ok := in[k].(string); ok && v != "" {
				return v
			}
		}
		return ""
	}
	switch name {
	case "Bash":
		if c := pick("command"); c != "" {
			return firstLine(c)
		}
	case "Read", "Write", "Edit", "NotebookEdit":
		if p := pick("file_path", "path", "notebook_path"); p != "" {
			return name + " " + short(p)
		}
	case "Grep", "Glob":
		if p := pick("pattern"); p != "" {
			return name + " " + p
		}
	case "WebFetch", "WebSearch":
		if u := pick("url", "query"); u != "" {
			return name + " " + u
		}
	case "Task":
		if d := pick("description"); d != "" {
			return "Task: " + d
		}
	}
	return name
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i] + " …"
	}
	return s
}

func short(p string) string {
	parts := strings.Split(p, "/")
	if len(parts) <= 3 {
		return p
	}
	return ".../" + strings.Join(parts[len(parts)-2:], "/")
}

func flattenContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &blocks); err == nil {
		var sb strings.Builder
		for _, b := range blocks {
			if b.Type == "text" {
				sb.WriteString(b.Text)
			}
		}
		return sb.String()
	}
	return string(raw)
}
