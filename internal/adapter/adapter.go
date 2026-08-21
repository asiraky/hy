// Package adapter defines the contract every harness plugs into. Adapters emit
// canonical events and call host services. They never touch the log, the
// fanout, or a connection.
package adapter

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	"github.com/asiraky/hy/internal/proto"
)

// CreateOptions configures a new harness session.
type CreateOptions struct {
	SessionID string // caller-owned identity; the harness is told to use it where it can
	Cwd       string
	Model     string
	Mode      string
	Effort    string

	// Env is the provider instance's credential overlay, applied over the
	// ambient environment when the harness process spawns. It is the entire
	// multi-account mechanism: adapters never learn what an instance is, they
	// just export these variables. Nil means ambient credentials.
	Env map[string]string

	// Resume asks the harness to continue an existing conversation rather
	// than start a fresh one, so restarting the server does not amnesia the
	// agent. HarnessSessionID is the harness's own id when it differs from
	// SessionID.
	Resume           bool
	HarnessSessionID string
}

// PromptInput is one user turn.
type PromptInput struct {
	TurnID string
	Text   string
}

// Adapter creates harness sessions.
//
// An adapter is wholly responsible for whatever its harness needs to run —
// binaries, runtimes, sidecars, credentials — and reports that through Probe.
// The core never learns what any particular harness requires; it asks whether
// an adapter is ready and renders the answer.
type Adapter interface {
	ID() string
	Meta() HarnessMeta
	// Models is the built-in fallback list, used only until (or unless) a live
	// ListModels answer arrives. It is deliberately small: the real list comes
	// from the harness.
	Models() []ModelMeta
	// PermissionModes returns the permission presets this harness offers, most
	// permissive last. The id is opaque to the server and the UI; only the
	// adapter interprets it.
	PermissionModes() []PermissionModeMeta
	// ListModels asks the harness which models it offers right now, under the
	// given instance's environment overlay (nil means ambient). It spawns the
	// harness, so it is slow and may fail; callers cache the answer and fall
	// back to Models. An adapter that cannot ask returns an error rather than
	// a guess.
	ListModels(ctx context.Context, env map[string]string) ([]ModelMeta, error)
	// Probe reports whether this harness can start right now, under the given
	// provider instance's environment overlay (nil means ambient). It must be
	// cheap, must not mutate anything, and must never block for long: it runs
	// at startup and whenever a UI asks to re-check. It runs per instance, so
	// two accounts can report independent health.
	Probe(ctx context.Context, env map[string]string) Availability
	CreateSession(ctx context.Context, host HostServices, o CreateOptions) (Session, error)
}

// HarnessMeta is everything a UI needs to present a harness. It lives here so
// that adding a harness requires no change to the server or to any client:
// presentation details travel with the adapter.
type HarnessMeta struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Accent is a CSS colour a UI may use to distinguish this harness.
	Accent string `json:"accent"`
	// DocsURL points at the harness's own documentation, for install hints.
	DocsURL string `json:"docsUrl,omitempty"`
}

// ModelMeta is a selectable model, as the harness itself describes it.
//
// Everything but Group is the harness's own answer: hy does not know what
// models exist, what they are called, or which one is the default. Group is
// the adapter's one presentation call — which of its models a UI should fold
// away as superseded — because no harness reports that today.
type ModelMeta struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	// Version names the generation behind the label ("Opus 5 with 1M
	// context", "5.6"), so a row can say which Opus it is.
	Version string `json:"version,omitempty"`
	// Description is the harness's one-line summary of what the model is for.
	Description string `json:"description,omitempty"`
	// Resolves is the concrete model an alias stands for, so a UI can say what
	// "Default" actually runs.
	Resolves string `json:"resolves,omitempty"`
	// Group is "" for a current model and GroupLegacy for a superseded one a
	// UI should collapse. Any other value is a group name a UI renders
	// verbatim.
	Group string `json:"group,omitempty"`
	// Default marks the model the harness itself would pick. Exactly one row
	// should carry it; a UI preselects that row rather than inventing a
	// "Default" entry of its own.
	Default bool `json:"default,omitempty"`
	// Efforts are the reasoning levels this model accepts, most modest first.
	// They are per model — one harness offers "ultra" on its newest models
	// only — so an effort control reads them rather than assuming a fixed set.
	Efforts []string `json:"efforts,omitempty"`
}

// GroupLegacy marks a model kept for continuity rather than offered first.
const GroupLegacy = "legacy"

// PermissionModeMeta is one permission preset a harness offers. Like
// ModelMeta, it travels from the adapter to the UI as opaque data: the server
// never interprets the id, and a harness with a different permission shape
// (one enum, two axes, whatever) maps its own ids in its own adapter.
type PermissionModeMeta struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	// Default marks the mode selected when the user has expressed no
	// preference. It matches what an empty CreateOptions.Mode does.
	Default bool `json:"default,omitempty"`
}

// Availability states.
const (
	StateReady       = "ready"
	StateUnavailable = "unavailable"
)

// Remedy is one actionable step a user can take to make a harness available.
type Remedy struct {
	Text string `json:"text"`
	// URL is optional; a UI may render Text as a link to it.
	URL string `json:"url,omitempty"`
	// Command is optional; a shell command the user could run.
	Command string `json:"command,omitempty"`
}

// Availability is an adapter's self-report. An unavailable adapter is still
// registered and still listed — it simply cannot start a session, and says
// why in terms its own harness understands.
type Availability struct {
	State  string   `json:"state"`
	Reason string   `json:"reason,omitempty"`
	Remedy []Remedy `json:"remedy,omitempty"`
	// Facts are diagnostic key/values (resolved paths, versions). Displayed
	// verbatim; never interpreted by the core.
	Facts map[string]string `json:"facts,omitempty"`
}

func Ready(facts map[string]string) Availability {
	return Availability{State: StateReady, Facts: facts}
}

func Unavailable(reason string, remedy ...Remedy) Availability {
	return Availability{State: StateUnavailable, Reason: reason, Remedy: remedy}
}

func (a Availability) OK() bool { return a.State == StateReady }

// MergeEnv applies an instance's overlay onto a base environment, replacing
// any variable the overlay names. Overlay keys are applied in sorted order so
// the result is deterministic. This is the whole credential mechanism: no
// value is ever handed to an SDK directly.
func MergeEnv(base []string, overlay map[string]string) []string {
	if len(overlay) == 0 {
		return base
	}
	out := make([]string, 0, len(base)+len(overlay))
	for _, entry := range base {
		name, _, ok := strings.Cut(entry, "=")
		if ok {
			if _, shadowed := overlay[name]; shadowed {
				continue
			}
		}
		out = append(out, entry)
	}
	names := make([]string, 0, len(overlay))
	for name := range overlay {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		out = append(out, name+"="+overlay[name])
	}
	return out
}

// Session is one live harness process.
type Session interface {
	Prompt(ctx context.Context, in PromptInput) error
	Cancel(ctx context.Context) error
	// Events is closed when the harness is disposed.
	Events() <-chan proto.Emission
	Close() error
}

// ModeSwitcher is implemented by sessions whose harness can change permission
// mode mid-conversation. The mode is one of the adapter's own
// PermissionModes ids. A harness that cannot switch simply does not implement
// this, and the host reports that legibly instead of silently ignoring it.
type ModeSwitcher interface {
	SetMode(ctx context.Context, mode string) error
}

// ModelSwitcher is implemented by sessions whose harness can change model
// mid-conversation. The model is one of the adapter's own Models ids. A
// harness that cannot switch simply does not implement this, and the host
// reports that legibly instead of silently ignoring it.
type ModelSwitcher interface {
	SetModel(ctx context.Context, model string) error
}

// PermissionRequest is what an adapter asks a human, via the host.
type PermissionRequest struct {
	TurnID     string
	ToolCallID string
	ToolName   string
	Title      string
	RawInput   json.RawMessage
	Options    []proto.PermissionOption
}

// PermissionOutcome is the human's answer, routed back from any presenter.
type PermissionOutcome struct {
	Outcome  string // proto.Outcome*
	OptionID string
}

type ElicitationRequest struct {
	TurnID string
	Prompt string
	Schema json.RawMessage
}

type ElicitationResult struct {
	Action string
	Value  json.RawMessage
}

// Allowed reports whether the outcome permits the tool to run.
func (o PermissionOutcome) Allowed() bool {
	return o.Outcome == proto.OutcomeAllowOnce || o.Outcome == proto.OutcomeAllowAlways
}

// HostServices are capabilities the adapter must not implement itself.
// RequestPermission blocks until a permission.resolved event is appended — by
// any presenter — which is what makes permissions fungible across devices.
type HostServices interface {
	RequestPermission(ctx context.Context, req PermissionRequest) (PermissionOutcome, error)
	Elicit(ctx context.Context, req ElicitationRequest) (ElicitationResult, error)
	Logf(format string, args ...any)
}
