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

// The "Main checkout" side of the new-session toggle: run where the user
// already works, touch nothing on the way in or out.
func TestLocalSessionRunsInTheProjectRootAndSkipsHooks(t *testing.T) {
	root, _, _ := gitRepo(t)
	st, p := testProject(t, root)
	// A provision hook that would be destructive against a live checkout: if
	// it runs, it leaves evidence.
	for _, name := range []string{"provision", "deprovision"} {
		script := "#!/bin/sh\ntouch \"$HY_PROJECT_ROOT/" + name + "-ran\"\n"
		if err := os.WriteFile(filepath.Join(root, name), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	p.Config.Defaults.Workspace = "local"
	p.Config.Workspace.Provision = "provision"
	p.Config.Workspace.Deprovision = "deprovision"
	if err := st.PutProject(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	fa := &fakeAdapter{}
	mgr := NewManager(st, func(string, ...any) {}, fa)
	defer mgr.Shutdown()

	a, err := mgr.CreateProject(context.Background(), CreateProjectOptions{ProjectID: p.ID})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		m, e := st.Session(context.Background(), a.ID)
		return e == nil && (m.Phase == "ready" || m.Phase == "provision_failed")
	})
	m, err := st.Session(context.Background(), a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if m.Phase != "ready" {
		t.Fatalf("phase %q, want ready", m.Phase)
	}
	if resolve(m.Cwd) != resolve(root) {
		t.Fatalf("cwd %s, want the project root %s", m.Cwd, root)
	}
	if m.WorkspaceMode != "local" {
		t.Fatalf("workspace mode %q, want local", m.WorkspaceMode)
	}
	// The session is on whatever the checkout was already on. No branch was
	// created, so none may be claimed.
	if m.Branch != "main" {
		t.Fatalf("branch %q, want the checkout's own branch main", m.Branch)
	}
	// Cleared at creation, not merely skipped at run time: the record itself
	// must show there is nothing to run.
	if m.ProvisionScript != "" || m.DeprovisionScript != "" {
		t.Fatalf("hooks survived onto a local session: %q / %q", m.ProvisionScript, m.DeprovisionScript)
	}
	if _, err := os.Stat(filepath.Join(root, ".worktrees")); !os.IsNotExist(err) {
		t.Fatal("a local session must not create a worktree")
	}
	if _, err := os.Stat(filepath.Join(root, "provision-ran")); !os.IsNotExist(err) {
		t.Fatal("the provision hook ran against the user's own checkout")
	}

	// Closing it is the dangerous half: nothing hy did not create may go.
	if err := mgr.Cleanup(context.Background(), a.ID); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		c, e := st.Session(context.Background(), a.ID)
		return e == nil && c.Phase == "closed"
	})
	if _, err := os.Stat(filepath.Join(root, "README")); err != nil {
		t.Fatalf("cleanup removed files from the main checkout: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "deprovision-ran")); !os.IsNotExist(err) {
		t.Fatal("the deprovision hook ran against the user's own checkout")
	}
}

// Two agents in one directory overwrite each other's edits, so the second is
// refused rather than merely warned about.
func TestSecondLocalSessionIsRefusedWhileTheFirstIsLive(t *testing.T) {
	root, _, _ := gitRepo(t)
	st, p := testProject(t, root)
	mgr := NewManager(st, func(string, ...any) {}, &fakeAdapter{})
	defer mgr.Shutdown()

	first, err := mgr.CreateProject(context.Background(), CreateProjectOptions{ProjectID: p.ID, Workspace: "local"})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		m, e := st.Session(context.Background(), first.ID)
		return e == nil && m.Phase == "ready"
	})

	if _, err := mgr.CreateProject(context.Background(), CreateProjectOptions{ProjectID: p.ID, Workspace: "local"}); err == nil {
		t.Fatal("a second local session in the same checkout should be refused")
	}
	// A worktree session is unaffected: it has a directory of its own.
	if _, err := mgr.CreateProject(context.Background(), CreateProjectOptions{
		ProjectID: p.ID, Workspace: "managed", Branch: "issue/9-elsewhere",
	}); err != nil {
		t.Fatalf("a managed session should still be allowed: %v", err)
	}

	// Once the holder closes, the checkout is free again.
	if err := mgr.Cleanup(context.Background(), first.ID); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		m, e := st.Session(context.Background(), first.ID)
		return e == nil && m.Phase == "closed"
	})
	if _, err := mgr.CreateProject(context.Background(), CreateProjectOptions{ProjectID: p.ID, Workspace: "local"}); err != nil {
		t.Fatalf("the checkout should be reusable once released: %v", err)
	}
}

// Force delete is the one path that removes a worktree without a hook, and it
// must still recognise a checkout that was never hy's to remove.
func TestForceDeleteOfALocalSessionRemovesNothing(t *testing.T) {
	root, _, _ := gitRepo(t)
	st, p := testProject(t, root)
	mgr := NewManager(st, func(string, ...any) {}, &fakeAdapter{})
	defer mgr.Shutdown()

	a, err := mgr.CreateProject(context.Background(), CreateProjectOptions{ProjectID: p.ID, Workspace: "local"})
	if err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		m, e := st.Session(context.Background(), a.ID)
		return e == nil && m.Phase == "ready"
	})
	if err := st.SetPhase(context.Background(), a.ID, "cleanup_failed"); err != nil {
		t.Fatal(err)
	}
	if err := mgr.ForceDelete(context.Background(), a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "README")); err != nil {
		t.Fatalf("force delete removed files from the main checkout: %v", err)
	}
}
