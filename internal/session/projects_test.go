package session

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/asiraky/hy/internal/project"
)

// The config held against a project is a cache of the file in the repo, so a
// pull that changes .hy/project.json has to take effect without the operator
// removing and re-adding the project.
func TestReloadProjectsTakesTheFileOverTheCache(t *testing.T) {
	root, _, _ := gitRepo(t)
	st, p := testProject(t, root)
	mgr := NewManager(st, func(string, ...any) {}, &fakeAdapter{})
	defer mgr.Shutdown()

	if err := os.MkdirAll(filepath.Join(root, ".hy"), 0o755); err != nil {
		t.Fatal(err)
	}
	cfg := project.DefaultConfig(root)
	cfg.Workspace.Provision = "scripts/hy-provision.mjs"
	cfg.Defaults.BaseBranch = "main"
	if err := os.WriteFile(filepath.Join(root, project.ConfigPath), mustJSON(t, cfg), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := mgr.ReloadProjects(context.Background()); err != nil {
		t.Fatal(err)
	}
	got, err := st.Project(context.Background(), p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Config.Workspace.Provision != "scripts/hy-provision.mjs" {
		t.Fatalf("provision hook is %q, want the one from the file", got.Config.Workspace.Provision)
	}
	if got.Config.Defaults.BaseBranch != "main" {
		t.Fatalf("base branch is %q, want main", got.Config.Defaults.BaseBranch)
	}
}

// A missing file means the checkout moved or is mid-checkout, not that the
// project's settings were cleared.
func TestReloadProjectsLeavesAProjectWithNoFileAlone(t *testing.T) {
	root, _, _ := gitRepo(t)
	st, p := testProject(t, root)
	mgr := NewManager(st, func(string, ...any) {}, &fakeAdapter{})
	defer mgr.Shutdown()

	before, err := st.Project(context.Background(), p.ID)
	if err != nil {
		t.Fatal(err)
	}
	before.Config.Workspace.Provision = "scripts/set-by-hand"
	if err := st.PutProject(context.Background(), before); err != nil {
		t.Fatal(err)
	}
	if err := mgr.ReloadProjects(context.Background()); err != nil {
		t.Fatal(err)
	}
	after, err := st.Project(context.Background(), p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Config.Workspace.Provision != "scripts/set-by-hand" {
		t.Fatalf("provision hook became %q; a missing file must not clear settings", after.Config.Workspace.Provision)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
