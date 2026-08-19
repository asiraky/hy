// Package proto defines the canonical event vocabulary that every harness
// adapter normalises into. It is the boundary of the system: adapters emit
// these, the log stores them, projections fold them, and UIs render them.
package proto

import (
	"encoding/json"
	"time"
)

// Event types. Lifecycle, content, and human interaction.
const (
	SessionCreated       = "session.created"
	SessionConfigChanged = "session.config_changed"
	SessionClosed        = "session.closed"

	TurnStarted  = "turn.started"
	TurnFinished = "turn.finished"

	MessageChunk    = "message.chunk"
	ToolCallStarted = "tool_call.started"
	ToolCallUpdated = "tool_call.updated"
	PlanUpdated     = "plan.updated"
	UsageUpdated    = "usage.updated"

	PermissionRequested  = "permission.requested"
	PermissionResolved   = "permission.resolved"
	ElicitationRequested = "elicitation.requested"
	ElicitationResolved  = "elicitation.resolved"

	WorkspaceRequested       = "workspace.requested"
	WorkspaceHookStarted     = "workspace.hook_started"
	WorkspaceHookOutput      = "workspace.hook_output"
	WorkspaceHookFinished    = "workspace.hook_finished"
	WorkspaceReady           = "workspace.ready"
	WorkspaceFailed          = "workspace.failed"
	WorkspaceCleanupStarted  = "workspace.cleanup_started"
	WorkspaceCleanupFinished = "workspace.cleanup_finished"
	WorkspaceCleanupFailed   = "workspace.cleanup_failed"
	WorkspaceReleased        = "workspace.released"
)

// Stop reasons for turn.finished.
const (
	StopEndTurn   = "end_turn"
	StopMaxTokens = "max_tokens"
	StopRefusal   = "refusal"
	StopCancelled = "cancelled"
	StopError     = "error"
)

// Tool call kinds and statuses.
const (
	KindRead    = "read"
	KindEdit    = "edit"
	KindDelete  = "delete"
	KindMove    = "move"
	KindSearch  = "search"
	KindExecute = "execute"
	KindThink   = "think"
	KindFetch   = "fetch"
	KindOther   = "other"

	StatusPending    = "pending"
	StatusInProgress = "in_progress"
	StatusCompleted  = "completed"
	StatusFailed     = "failed"
)

// Permission outcomes.
const (
	OutcomeAllowOnce    = "allow_once"
	OutcomeAllowAlways  = "allow_always"
	OutcomeRejectOnce   = "reject_once"
	OutcomeRejectAlways = "reject_always"
	OutcomeCancelled    = "cancelled"
)

// Event is one durable fact about a session. seq is a per-session monotonic
// integer assigned at append time; there is no global sequence.
type Event struct {
	SessionID string          `json:"sessionId"`
	Seq       int64           `json:"seq"`
	Timestamp int64           `json:"timestamp"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

// Emission is an event before it has been sequenced. Adapters emit these; the
// session actor stamps seq and timestamp at append.
type Emission struct {
	Type    string
	Payload any
}

func Emit(typ string, payload any) Emission { return Emission{Type: typ, Payload: payload} }

// NowMillis is the timestamp unit used throughout.
func NowMillis() int64 { return time.Now().UnixMilli() }

// ---- Payloads ----

type SessionCreatedPayload struct {
	Cwd     string `json:"cwd"`
	Harness string `json:"harness"`
	Model   string `json:"model,omitempty"`
	Mode    string `json:"mode,omitempty"`
	Effort  string `json:"effort,omitempty"`
	Title   string `json:"title,omitempty"`
}

type WorkspaceRequestedPayload struct {
	ProjectID   string `json:"projectId,omitempty"`
	ProjectRoot string `json:"projectRoot"`
	Mode        string `json:"mode"`
	Branch      string `json:"branch,omitempty"`
	BaseRef     string `json:"baseRef,omitempty"`
}

type WorkspaceHookStartedPayload struct {
	RunID   string `json:"runId"`
	Hook    string `json:"hook"`
	Command string `json:"command"`
}

type WorkspaceHookOutputPayload struct {
	RunID  string `json:"runId"`
	Hook   string `json:"hook"`
	Stream string `json:"stream"`
	Chunk  string `json:"chunk"`
}

type WorkspaceHookFinishedPayload struct {
	RunID      string `json:"runId"`
	Hook       string `json:"hook"`
	ExitCode   int    `json:"exitCode"`
	DurationMs int64  `json:"durationMs"`
}

type WorkspaceReadyPayload struct {
	Cwd       string         `json:"cwd"`
	Branch    string         `json:"branch,omitempty"`
	Resources map[string]any `json:"resources,omitempty"`
}

type WorkspaceFailedPayload struct {
	Hook     string `json:"hook"`
	Error    string `json:"error"`
	ExitCode int    `json:"exitCode,omitempty"`
}

type SessionConfigChangedPayload struct {
	Model string `json:"model,omitempty"`
	Mode  string `json:"mode,omitempty"`
	Title string `json:"title,omitempty"`
	// HarnessSessionID is the harness's own identifier for this conversation,
	// which is what a restart needs in order to resume with context intact.
	HarnessSessionID string `json:"harnessSessionId,omitempty"`
}

type SessionClosedPayload struct {
	Reason string `json:"reason"`
}

type TurnStartedPayload struct {
	TurnID string `json:"turnId"`
	Prompt string `json:"prompt"`
	// Recovery is set only on a turn the server started by itself, to finish
	// work a restart interrupted. It is absent on every human prompt.
	Recovery *TurnRecovery `json:"recovery,omitempty"`
}

// TurnRecovery describes a turn the server started to continue interrupted
// work. Attempt counts consecutive recoveries so a session that dies on every
// resume stops rather than restarting itself forever.
type TurnRecovery struct {
	ResumeOf string `json:"resumeOf"`
	Attempt  int    `json:"attempt"`
}

type TurnFinishedPayload struct {
	TurnID     string `json:"turnId"`
	StopReason string `json:"stopReason"`
	Error      string `json:"error,omitempty"`
}

// MessageChunkPayload carries a delta of assistant (or replayed user) content.
// BlockID groups deltas belonging to one content block so a projection can
// append without needing an index space shared across harnesses.
type MessageChunkPayload struct {
	TurnID  string `json:"turnId"`
	Role    string `json:"role"` // user | agent
	Kind    string `json:"kind"` // text | thought
	BlockID string `json:"blockId"`
	Delta   string `json:"delta"`
}

type ToolContent struct {
	Type string `json:"type"` // text | diff
	Text string `json:"text,omitempty"`
	Path string `json:"path,omitempty"`
	Old  string `json:"oldText,omitempty"`
	New  string `json:"newText,omitempty"`
}

type ToolCallStartedPayload struct {
	TurnID     string          `json:"turnId"`
	ToolCallID string          `json:"toolCallId"`
	Kind       string          `json:"kind"`
	Title      string          `json:"title"`
	Status     string          `json:"status"`
	RawInput   json.RawMessage `json:"rawInput,omitempty"`
}

type ToolCallUpdatedPayload struct {
	ToolCallID string          `json:"toolCallId"`
	Status     string          `json:"status,omitempty"`
	Title      string          `json:"title,omitempty"`
	Content    []ToolContent   `json:"content,omitempty"`
	RawInput   json.RawMessage `json:"rawInput,omitempty"`
}

type PlanEntry struct {
	Content  string `json:"content"`
	Status   string `json:"status"`
	Priority string `json:"priority,omitempty"`
}

type PlanUpdatedPayload struct {
	Entries []PlanEntry `json:"entries"`
}

type UsageUpdatedPayload struct {
	Input      int64   `json:"input"`
	Output     int64   `json:"output"`
	CacheRead  int64   `json:"cacheRead"`
	CacheWrite int64   `json:"cacheWrite"`
	Cost       float64 `json:"cost"`
	ContextPct float64 `json:"contextPct,omitempty"`
}

type PermissionOption struct {
	OptionID string `json:"optionId"`
	Name     string `json:"name"`
	Kind     string `json:"kind"` // allow_once | allow_always | reject_once | reject_always
}

type PermissionRequestedPayload struct {
	RequestID  string             `json:"requestId"`
	TurnID     string             `json:"turnId"`
	ToolCallID string             `json:"toolCallId"`
	ToolName   string             `json:"toolName"`
	Title      string             `json:"title"`
	RawInput   json.RawMessage    `json:"rawInput,omitempty"`
	Options    []PermissionOption `json:"options"`
}

type PermissionResolvedPayload struct {
	RequestID string `json:"requestId"`
	Outcome   string `json:"outcome"`
	OptionID  string `json:"optionId,omitempty"`
}

type ElicitationRequestedPayload struct {
	RequestID string          `json:"requestId"`
	TurnID    string          `json:"turnId,omitempty"`
	Prompt    string          `json:"prompt"`
	Schema    json.RawMessage `json:"schema"`
}

type ElicitationResolvedPayload struct {
	RequestID string          `json:"requestId"`
	Action    string          `json:"action"` // accept | decline | cancel
	Value     json.RawMessage `json:"value,omitempty"`
}

// DefaultPermissionOptions is the option set offered when a harness does not
// supply its own.
func DefaultPermissionOptions() []PermissionOption {
	return []PermissionOption{
		{OptionID: "allow_once", Name: "Allow once", Kind: OutcomeAllowOnce},
		{OptionID: "allow_always", Name: "Always allow this tool", Kind: OutcomeAllowAlways},
		{OptionID: "reject_once", Name: "Reject", Kind: OutcomeRejectOnce},
	}
}
