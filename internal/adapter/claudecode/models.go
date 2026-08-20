package claudecode

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/asiraky/hy/internal/adapter"
)

// modelListTimeout bounds the listing run. Asking costs a Claude Code start,
// so it is not fast; it is also not on any interactive path — the caller
// serves a cached or fallback list while this runs.
const modelListTimeout = 60 * time.Second

// Models is the fallback list: the aliases Claude Code has accepted for as
// long as hy has existed, used only until a live answer arrives or when the
// harness cannot be asked. It deliberately carries no versions — claiming a
// version we did not read from the harness is how the old hardcoded list went
// stale.
func (a *Adapter) Models() []adapter.ModelMeta {
	return []adapter.ModelMeta{
		{ID: "default", Label: "Default", Default: true},
		{ID: "opus", Label: "Opus"},
		{ID: "sonnet", Label: "Sonnet"},
		{ID: "haiku", Label: "Haiku"},
	}
}

// legacyModels are the older Opus versions Claude Code still accepts but no
// longer advertises: supportedModels() lists only current models, while
// `claude --model` documents full model names as valid. They are the one piece
// of model data hy hardcodes, so they need review whenever a new Opus ships —
// a name that stops being served will simply fail at session start, which is
// why they are grouped away rather than offered first.
//
// Reviewed against claude CLI 2.1.237.
var legacyModels = []adapter.ModelMeta{
	{ID: "claude-opus-4-8", Label: "Opus 4.8", Version: "Opus 4.8", Description: "The previous Opus generation."},
	{ID: "claude-opus-4-7", Label: "Opus 4.7", Version: "Opus 4.7", Description: "An older Opus generation."},
	{ID: "claude-opus-4-6", Label: "Opus 4.6", Version: "Opus 4.6", Description: "An older Opus generation."},
}

// modelInfo is the SDK's ModelInfo, as the sidecar relays it.
type modelInfo struct {
	Value                 string   `json:"value"`
	ResolvedModel         string   `json:"resolvedModel"`
	DisplayName           string   `json:"displayName"`
	Description           string   `json:"description"`
	SupportedEffortLevels []string `json:"supportedEffortLevels"`
}

// ListModels asks the installed Claude Code what it offers, by running the
// bridge in its one-shot listing mode. The answer is the SDK's own, so a new
// model or a renamed one appears in hy without a release.
func (a *Adapter) ListModels(ctx context.Context, env map[string]string) ([]adapter.ModelMeta, error) {
	r, avail := a.resolve(ctx)
	if !avail.OK() {
		return nil, fmt.Errorf("claude is unavailable: %s", avail.Reason)
	}

	blob, err := json.Marshal(sidecarConfig{Op: "models", Cwd: workingDir(), ClaudePath: r.claudePath})
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(ctx, modelListTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, r.runtime, append(append([]string{}, r.runtimeArgs...), string(blob))...)
	cmd.Dir = workingDir()
	cmd.Env = append(adapter.MergeEnv(os.Environ(), env), "CLAUDE_CODE_ENTRYPOINT=sdk-ts")
	cmd.Stderr = nil

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start claude bridge: %w", err)
	}
	// The process is short-lived by design, but a wedged one must not outlive
	// this call: killing it is what the deadline is for.
	defer func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
	}()

	var models []adapter.ModelMeta
	var fatal string
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		var frame struct {
			Method string `json:"method"`
			Params struct {
				Models  []modelInfo `json:"models"`
				Message string      `json:"message"`
			} `json:"params"`
		}
		if err := json.Unmarshal(sc.Bytes(), &frame); err != nil {
			continue
		}
		switch frame.Method {
		case "models":
			models = mapClaudeModels(frame.Params.Models)
		case "fatal":
			fatal = frame.Params.Message
		}
		if models != nil || fatal != "" {
			break
		}
	}
	switch {
	case len(models) > 0:
		return models, nil
	case fatal != "":
		return nil, fmt.Errorf("claude model listing failed: %s", firstLine(strings.TrimSpace(fatal)))
	case ctx.Err() != nil:
		return nil, fmt.Errorf("claude model listing: %w", ctx.Err())
	default:
		return nil, fmt.Errorf("claude model listing returned nothing")
	}
}

// mapClaudeModels turns the SDK's rows into hy's, and appends the curated
// legacy group. The SDK packs generation and purpose into one description
// ("Opus 5 with 1M context · Best for everyday, complex tasks"); splitting on
// its own separator is what lets a row show which Opus it is next to what the
// model is for.
func mapClaudeModels(in []modelInfo) []adapter.ModelMeta {
	if len(in) == 0 {
		return nil
	}
	out := make([]adapter.ModelMeta, 0, len(in)+len(legacyModels))
	for _, m := range in {
		if m.Value == "" {
			continue
		}
		version, description := splitDescription(m.Description)
		out = append(out, adapter.ModelMeta{
			ID:          m.Value,
			Label:       m.DisplayName,
			Version:     version,
			Description: description,
			Resolves:    m.ResolvedModel,
			// The SDK has no isDefault flag; the row it *calls* "default" is
			// the one Claude Code itself would pick.
			Default: m.Value == "default",
			Efforts: m.SupportedEffortLevels,
		})
	}
	for _, m := range legacyModels {
		m.Group = adapter.GroupLegacy
		out = append(out, m)
	}
	return out
}

// splitDescription separates the generation from the summary. A description
// with no separator is all summary: inventing a version from a sentence would
// be a guess.
func splitDescription(s string) (version, description string) {
	before, after, found := strings.Cut(s, " · ")
	if !found {
		return "", strings.TrimSpace(s)
	}
	return strings.TrimSpace(before), strings.TrimSpace(after)
}

// workingDir gives the listing run somewhere to be. The answer does not depend
// on the directory, so any real one will do — but the SDK insists on one.
func workingDir() string {
	if wd, err := os.Getwd(); err == nil {
		return wd
	}
	return os.TempDir()
}
