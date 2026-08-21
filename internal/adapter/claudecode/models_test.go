package claudecode

import (
	"testing"

	"github.com/asiraky/hy/internal/adapter"
)

// The SDK's own rows, as observed from claude CLI 2.1.237. The mapping has to
// survive them verbatim: this is the shape hy actually receives.
func liveRows() []modelInfo {
	return []modelInfo{
		{Value: "default", ResolvedModel: "claude-opus-5[1m]", DisplayName: "Default (recommended)", Description: "Opus 5 with 1M context · Best for everyday, complex tasks", SupportedEffortLevels: []string{"low", "medium", "high", "xhigh", "max"}},
		{Value: "claude-fable-5[1m]", ResolvedModel: "claude-fable-5", DisplayName: "Fable", Description: "Fable 5 · Most capable for your hardest and longest-running tasks"},
		{Value: "haiku", ResolvedModel: "claude-haiku-4-5-20251001", DisplayName: "Haiku", Description: "Haiku 4.5 · Fastest for quick answers"},
	}
}

func TestMapClaudeModelsSplitsVersionFromDescription(t *testing.T) {
	got := mapClaudeModels(liveRows())

	fable := findModel(t, got, "claude-fable-5[1m]")
	if fable.Label != "Fable" {
		t.Errorf("label = %q, want Fable", fable.Label)
	}
	if fable.Version != "Fable 5" {
		t.Errorf("version = %q, want %q", fable.Version, "Fable 5")
	}
	if fable.Description != "Most capable for your hardest and longest-running tasks" {
		t.Errorf("description = %q, still carries the version", fable.Description)
	}
	if fable.Resolves != "claude-fable-5" {
		t.Errorf("resolves = %q, want claude-fable-5", fable.Resolves)
	}
}

// The picker preselects whatever the harness calls its default, so exactly one
// row must carry the flag — and it must be the harness's row, not one hy
// invented.
func TestMapClaudeModelsMarksOneDefault(t *testing.T) {
	got := mapClaudeModels(liveRows())

	var defaults []string
	for _, m := range got {
		if m.Default {
			defaults = append(defaults, m.ID)
		}
	}
	if len(defaults) != 1 || defaults[0] != "default" {
		t.Fatalf("default rows = %v, want exactly [default]", defaults)
	}
	if got[0].ID != "default" {
		t.Errorf("first row = %q, want the default first", got[0].ID)
	}
	if got[0].Version != "Opus 5 with 1M context" {
		t.Errorf("the default row must name what it resolves to; version = %q", got[0].Version)
	}
}

// hy offers only what the harness serves: no hardcoded legacy group is
// appended, because the installed Claude Code no longer serves those older ids
// and offering a model it will not run is what let the picker and the context
// meter disagree.
func TestMapClaudeModelsOffersOnlyLiveRows(t *testing.T) {
	got := mapClaudeModels(liveRows())

	if len(got) != len(liveRows()) {
		t.Fatalf("len = %d, want exactly the live rows", len(got))
	}
	for _, m := range got {
		if m.Group != "" {
			t.Errorf("%s group = %q, want current — nothing is folded away", m.ID, m.Group)
		}
	}
}

func TestMapClaudeModelsIgnoresEmptyAndUnlisted(t *testing.T) {
	if got := mapClaudeModels(nil); got != nil {
		t.Errorf("no live rows should map to nothing, got %v", got)
	}
	got := mapClaudeModels([]modelInfo{{Value: ""}, {Value: "sonnet", DisplayName: "Sonnet", Description: "Sonnet 5"}})
	if len(got) != 1 {
		t.Fatalf("len = %d, want the one real row", len(got))
	}
	sonnet := findModel(t, got, "sonnet")
	// A description with no separator is all version, not half a sentence.
	if sonnet.Version != "" || sonnet.Description != "Sonnet 5" {
		t.Errorf("unseparated description split into %q / %q", sonnet.Version, sonnet.Description)
	}
}

func findModel(t *testing.T, in []adapter.ModelMeta, id string) adapter.ModelMeta {
	t.Helper()
	for _, m := range in {
		if m.ID == id {
			return m
		}
	}
	t.Fatalf("no model %q in %v", id, in)
	return adapter.ModelMeta{}
}
