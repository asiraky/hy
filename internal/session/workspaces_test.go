package session

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/asiraky/hy/internal/project"
	"github.com/asiraky/hy/internal/proto"
	"github.com/asiraky/hy/internal/store"
)

// gitRepo builds a repository with one extra worktree, which is the shape the
// picker exists to offer: a checkout hy did not create but can still attach to.
func gitRepo(t *testing.T) (root, worktree, branch string) {
	t.Helper()
	root = t.TempDir()
	run := func(dir string, args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
		}
	}
	run(root, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(root, "README"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run(root, "add", "README")
	run(root, "commit", "-m", "init")
	worktree, branch = filepath.Join(t.TempDir(), "side"), "issue/1-side"
	run(root, "worktree", "add", worktree, "-b", branch)
	return root, worktree, branch
}

func testProject(t *testing.T, root string) (*store.Store, project.Project) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "workspaces.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	now := proto.NowMillis()
	p := project.Project{ID: "p1", Root: root, CreatedAt: now, UpdatedAt: now, Config: project.DefaultConfig(root)}
	p.Config.Defaults.Harness = "fake"
	if err := st.PutProject(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	return st, p
}

func find(spaces []Workspace, path string) (Workspace, bool) {
	for _, w := range spaces {
		if resolve(w.Path) == resolve(path) {
			return w, true
		}
	}
	return Workspace{}, false
}

func resolve(path string) string {
	if canonical, err := filepath.EvalSymlinks(path); err == nil {
		return canonical
	}
	return path
}

func TestListWorkspacesReportsRootAndWorktrees(t *testing.T) {
	root, worktree, branch := gitRepo(t)
	st, p := testProject(t, root)
	mgr := NewManager(st, func(string, ...any) {}, &fakeAdapter{})
	defer mgr.Shutdown()

	spaces, err := mgr.ListWorkspaces(context.Background(), p.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := find(spaces, root)
	if !ok || !got.IsRoot || got.Branch != "main" {
		t.Fatalf("project root missing or mislabelled: %+v", spaces)
	}
	side, ok := find(spaces, worktree)
	if !ok || side.IsRoot || side.Branch != branch {
		t.Fatalf("existing worktree missing or mislabelled: %+v", spaces)
	}
	if side.Busy {
		t.Fatal("an unused worktree must not be reported busy")
	}
}

func TestListWorkspacesMarksCheckoutsHeldByLiveSessions(t *testing.T) {
	root, worktree, _ := gitRepo(t)
	st, p := testProject(t, root)
	mgr := NewManager(st, func(string, ...any) {}, &fakeAdapter{})
	defer mgr.Shutdown()

	now := proto.NowMillis()
	meta := store.SessionMeta{ID: "s1", Cwd: worktree, Harness: "fake", Title: "already here", CreatedAt: now, UpdatedAt: now, Phase: "idle", ProjectID: p.ID}
	if err := st.CreateSession(context.Background(), meta); err != nil {
		t.Fatal(err)
	}

	spaces, err := mgr.ListWorkspaces(context.Background(), p.ID)
	if err != nil {
		t.Fatal(err)
	}
	side, ok := find(spaces, worktree)
	if !ok || !side.Busy || side.BusySessionID != "s1" || side.BusyTitle != "already here" {
		t.Fatalf("held worktree not reported busy: %+v", side)
	}
	// Two harnesses in one checkout corrupt each other's edits, so attaching
	// must be refused rather than merely discouraged in the UI.
	if _, err := mgr.ResolveWorkspace(context.Background(), p.ID, worktree); err == nil {
		t.Fatal("attaching to a busy workspace should fail")
	}
}

func TestResolveWorkspaceRejectsDirectoriesOutsideTheProject(t *testing.T) {
	root, worktree, _ := gitRepo(t)
	st, p := testProject(t, root)
	mgr := NewManager(st, func(string, ...any) {}, &fakeAdapter{})
	defer mgr.Shutdown()

	if _, err := mgr.ResolveWorkspace(context.Background(), p.ID, t.TempDir()); err == nil {
		t.Fatal("a directory that is not a worktree of this project must be refused")
	}
	if _, err := mgr.ResolveWorkspace(context.Background(), p.ID, worktree); err != nil {
		t.Fatalf("a real worktree should resolve: %v", err)
	}
}

func TestCreateProjectAttachesToExistingWorktreeWithoutProvisioning(t *testing.T) {
	root, worktree, branch := gitRepo(t)
	st, p := testProject(t, root)
	fa := &fakeAdapter{}
	mgr := NewManager(st, func(string, ...any) {}, fa)
	defer mgr.Shutdown()

	a, err := mgr.CreateProject(context.Background(), CreateProjectOptions{ProjectID: p.ID, WorkspacePath: worktree})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		meta, err := st.Session(context.Background(), a.ID)
		return err == nil && meta.Phase == "ready"
	})
	meta, err := st.Session(context.Background(), a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if resolve(meta.Cwd) != resolve(worktree) {
		t.Fatalf("session ran in %s, want the borrowed worktree %s", meta.Cwd, worktree)
	}
	if meta.WorkspaceMode != "borrowed" {
		t.Fatalf("workspace mode is %q, want borrowed", meta.WorkspaceMode)
	}
	if meta.Branch != branch {
		t.Fatalf("branch is %q, want %q", meta.Branch, branch)
	}

	// The whole point of borrowing: hy did not make this checkout, so closing
	// the session must leave it exactly where it was.
	if err := mgr.Cleanup(context.Background(), a.ID); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		m, err := st.Session(context.Background(), a.ID)
		return err == nil && m.Phase == "closed"
	})
	if _, err := os.Stat(worktree); err != nil {
		t.Fatalf("cleanup removed a borrowed worktree: %v", err)
	}
}

func TestParseWorktreeListReadsDetachedHeads(t *testing.T) {
	porcelain := "worktree /repo\nHEAD 1234567890abcdef\nbranch refs/heads/main\n\n" +
		"worktree /repo/.worktrees/loose\nHEAD fedcba0987654321\ndetached\nlocked\n"
	got := parseWorktreeList(porcelain, "/repo")
	if len(got) != 2 {
		t.Fatalf("parsed %d worktrees, want 2", len(got))
	}
	if !got[0].IsRoot || got[0].Branch != "main" || got[0].Head != "12345678" {
		t.Fatalf("root parsed wrong: %+v", got[0])
	}
	if got[1].IsRoot || got[1].Branch != "" || got[1].Head != "fedcba09" || !got[1].Locked {
		t.Fatalf("detached worktree parsed wrong: %+v", got[1])
	}
}

// Exactly what the user will do: type a branch name into the picker on a
// project whose default workspace is "local", and expect a worktree.
func TestTypedBranchCreatesWorktreeEvenWhenProjectDefaultIsLocal(t *testing.T) {
	root, _, _ := gitRepo(t)
	st, p := testProject(t, root)
	if p.Config.Defaults.Workspace != "local" {
		t.Fatalf("precondition: default workspace is %q", p.Config.Defaults.Workspace)
	}
	fa := &fakeAdapter{}
	mgr := NewManager(st, func(string, ...any) {}, fa)
	defer mgr.Shutdown()

	a, err := mgr.CreateProject(context.Background(), CreateProjectOptions{
		ProjectID: p.ID, Workspace: "managed", Branch: "issue/42-typed-in",
	})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		m, err := st.Session(context.Background(), a.ID)
		return err == nil && (m.Phase == "ready" || m.Phase == "provision_failed")
	})
	m, _ := st.Session(context.Background(), a.ID)
	if m.Phase != "ready" {
		t.Fatalf("phase %q, want ready", m.Phase)
	}
	want := filepath.Join(root, ".worktrees", "issue-42-typed-in")
	if resolve(m.Cwd) != resolve(want) {
		t.Fatalf("cwd %s, want %s", m.Cwd, want)
	}
	if _, err := os.Stat(filepath.Join(m.Cwd, "README")); err != nil {
		t.Fatalf("worktree has no checkout: %v", err)
	}
	if m.Branch != "issue/42-typed-in" {
		t.Fatalf("branch %q", m.Branch)
	}
	if fa.session() == nil {
		t.Fatal("harness never started in the new worktree")
	}
}

// The same, but with the worktree root pointed outside the repo.
func TestSuggestedRootMayLiveOutsideTheProject(t *testing.T) {
	root, _, _ := gitRepo(t)
	st, p := testProject(t, root)
	p.Config.Workspace.SuggestedRoot = "../sibling-worktrees"
	if err := st.PutProject(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	mgr := NewManager(st, func(string, ...any) {}, &fakeAdapter{})
	defer mgr.Shutdown()

	a, err := mgr.CreateProject(context.Background(), CreateProjectOptions{
		ProjectID: p.ID, Workspace: "managed", Branch: "issue/7-outside",
	})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		m, err := st.Session(context.Background(), a.ID)
		return err == nil && (m.Phase == "ready" || m.Phase == "provision_failed")
	})
	m, _ := st.Session(context.Background(), a.ID)
	if m.Phase != "ready" {
		t.Fatalf("phase %q, want ready", m.Phase)
	}
	want := filepath.Join(filepath.Dir(root), "sibling-worktrees", "issue-7-outside")
	if resolve(m.Cwd) != resolve(want) {
		t.Fatalf("cwd %s, want %s", m.Cwd, want)
	}
	if _, err := os.Stat(filepath.Join(m.Cwd, "README")); err != nil {
		t.Fatalf("worktree has no checkout: %v", err)
	}
}
