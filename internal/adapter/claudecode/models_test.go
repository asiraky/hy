package claudecode

import (
	"testing"

	"github.com/asiraky/hy/internal/adapter"
)

// The SDK's own rows, as observed from claude CLI 2.1.238. The mapping has to
// survive them verbatim: this is the shape hy actually receives — including the
// twin Opus aliases (a generic "default" and a named "opus[1m]") that resolve
// to the same model, and a Haiku row.
func liveRows() []modelInfo {
	return []modelInfo{
		{Value: "default", ResolvedModel: "claude-opus-5[1m]", DisplayName: "Default (recommended)", Description: "Opus 5 with 1M context · Best for everyday, complex tasks", SupportedEffortLevels: []string{"low", "medium", "high", "xhigh", "max"}},
		{Value: "opus[1m]", ResolvedModel: "claude-opus-5[1m]", DisplayName: "Opus (1M context)", Description: "Opus 5 with 1M context · Best for everyday, complex tasks", SupportedEffortLevels: []string{"low", "medium", "high", "xhigh", "max"}},
		{Value: "fable", ResolvedModel: "claude-fable-5", DisplayName: "Fable", Description: "Fable 5 · Most capable for your hardest and longest-running tasks", SupportedEffortLevels: []string{"low", "medium", "high", "xhigh", "max"}},
		{Value: "sonnet", ResolvedModel: "claude-sonnet-5", DisplayName: "Sonnet", Description: "Sonnet 5 · Efficient for routine tasks", SupportedEffortLevels: []string{"low", "medium", "high", "xhigh", "max"}},
		{Value: "haiku", ResolvedModel: "claude-haiku-4-5-20251001", DisplayName: "Haiku", Description: "Haiku 4.5 · Fastest for quick answers"},
	}
}

func TestMapClaudeModelsSplitsVersionFromDescription(t *testing.T) {
	got := mapClaudeModels(liveRows())

	fable := findModel(t, got, "fable")
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

// Haiku is a quick-answer model, not a coding one, so it is dropped however the
// harness names it.
func TestMapClaudeModelsDropsHaiku(t *testing.T) {
	for _, m := range mapClaudeModels(liveRows()) {
		if m.ID == "haiku" {
			t.Fatalf("haiku was offered: %+v", m)
		}
	}
}

// The two Opus aliases resolve to the same model, so the picker shows one row —
// the named one — and it carries the recommended flag the generic "default"
// alias had. Exactly one row is the default.
func TestMapClaudeModelsMergesTwinOpusRows(t *testing.T) {
	got := mapClaudeModels(liveRows())

	var opus []adapter.ModelMeta
	var defaults []string
	for _, m := range got {
		if m.Resolves == "claude-opus-5[1m]" {
			opus = append(opus, m)
		}
		if m.Default {
			defaults = append(defaults, m.ID)
		}
	}
	if len(opus) != 1 {
		t.Fatalf("rows resolving to Opus 5 = %d, want 1 merged row", len(opus))
	}
	if opus[0].ID != "opus[1m]" {
		t.Errorf("kept row = %q, want the named opus[1m] alias, not the generic default", opus[0].ID)
	}
	if len(defaults) != 1 || defaults[0] != "opus[1m]" {
		t.Fatalf("default rows = %v, want exactly [opus[1m]]", defaults)
	}
}

// Current models are ordered by strength — Fable, Opus, Sonnet — and the
// curated legacy group is appended, folded away.
func TestMapClaudeModelsOrdersByStrengthThenLegacy(t *testing.T) {
	got := mapClaudeModels(liveRows())

	var currentIDs []string
	for _, m := range got {
		if m.Group == "" {
			currentIDs = append(currentIDs, m.ID)
		}
	}
	want := []string{"fable", "opus[1m]", "sonnet"}
	if len(currentIDs) != len(want) {
		t.Fatalf("current ids = %v, want %v", currentIDs, want)
	}
	for i := range want {
		if currentIDs[i] != want[i] {
			t.Fatalf("current order = %v, want %v", currentIDs, want)
		}
	}
	// The curated legacy group is appended after every current row.
	firstLegacy := len(currentIDs)
	if len(got) != firstLegacy+len(legacyModels) {
		t.Fatalf("len = %d, want %d current + %d legacy", len(got), firstLegacy, len(legacyModels))
	}
	for _, want := range legacyModels {
		m := findModel(t, got, want.ID)
		if m.Group != adapter.GroupLegacy {
			t.Errorf("%s group = %q, want legacy", m.ID, m.Group)
		}
		// A legacy row must not repeat its label as a version — that double
		// render is the bug that started this.
		if m.Version == m.Label && m.Version != "" {
			t.Errorf("%s renders its name twice (label==version)", m.ID)
		}
	}
}

func TestMapClaudeModelsIgnoresEmptyAndUnlisted(t *testing.T) {
	if got := mapClaudeModels(nil); got != nil {
		t.Errorf("no live rows should map to nothing, got %v", got)
	}
	got := mapClaudeModels([]modelInfo{{Value: ""}, {Value: "sonnet", ResolvedModel: "claude-sonnet-5", DisplayName: "Sonnet", Description: "Sonnet 5"}})
	if len(got) != 1+len(legacyModels) {
		t.Fatalf("len = %d, want the one real row plus legacy", len(got))
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
