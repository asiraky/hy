package session

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/asiraky/hy/internal/proto"
	"github.com/asiraky/hy/internal/store"
)

func gitRun(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
}

func write(t *testing.T, dir, name, body string) {
	t.Helper()
	full := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// changesFixture is a session working in a worktree cut from main, with one
// committed edit, one uncommitted edit, one delete, one rename and one
// untracked file — every status the file list has to name.
func changesFixture(t *testing.T) (*Manager, string) {
	t.Helper()
	root, worktree, _ := gitRepo(t)
	write(t, root, "keep.txt", "one\ntwo\nthree\n")
	write(t, root, "gone.txt", "bye\n")
	write(t, root, "old-name.txt", "same\n")
	gitRun(t, root, "add", ".")
	gitRun(t, root, "commit", "-m", "base")
	gitRun(t, worktree, "merge", "main")

	write(t, worktree, "keep.txt", "one\ntwo\nthree\nfour\n")
	gitRun(t, worktree, "add", "keep.txt")
	gitRun(t, worktree, "commit", "-m", "committed edit")
	write(t, worktree, "new.txt", "fresh\n")
	gitRun(t, worktree, "add", "new.txt")
	gitRun(t, worktree, "rm", "-q", "gone.txt")
	gitRun(t, worktree, "mv", "old-name.txt", "new-name.txt")
	write(t, worktree, "untracked.txt", "a\nb\n")

	st, p := testProject(t, root)
	mgr := NewManager(st, func(string, ...any) {}, &fakeAdapter{})
	t.Cleanup(mgr.Shutdown)
	now := proto.NowMillis()
	meta := store.SessionMeta{ID: "s1", Cwd: worktree, Harness: "fake", CreatedAt: now, UpdatedAt: now, Phase: "idle", ProjectID: p.ID}
	if err := st.CreateSession(context.Background(), meta); err != nil {
		t.Fatal(err)
	}
	return mgr, "s1"
}

func fileNamed(t *testing.T, files []ChangedFile, path string) ChangedFile {
	t.Helper()
	for _, f := range files {
		if f.Path == path {
			return f
		}
	}
	t.Fatalf("%s missing from %+v", path, files)
	return ChangedFile{}
}

func TestSessionChangesAggregatesTheWholeWorktreeAgainstItsBase(t *testing.T) {
	mgr, id := changesFixture(t)
	changes, err := mgr.SessionChanges(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if changes.Warning != "" {
		t.Fatalf("unexpected warning: %s", changes.Warning)
	}
	if changes.BaseRef != "main" {
		t.Fatalf("base branch not found: %+v", changes)
	}

	// A committed edit counts as much as an uncommitted one: the session made
	// both, and a reviewer wants to see them together.
	if got := fileNamed(t, changes.Files, "keep.txt"); got.Status != "modified" || got.Additions != 1 || got.Deletions != 0 {
		t.Fatalf("committed edit mis-measured: %+v", got)
	}
	if got := fileNamed(t, changes.Files, "gone.txt"); got.Status != "deleted" {
		t.Fatalf("delete mis-measured: %+v", got)
	}
	if got := fileNamed(t, changes.Files, "new-name.txt"); got.Status != "renamed" || got.OldPath != "old-name.txt" {
		t.Fatalf("rename mis-measured: %+v", got)
	}
	if got := fileNamed(t, changes.Files, "new.txt"); got.Status != "added" || got.Additions != 1 {
		t.Fatalf("added file mis-measured: %+v", got)
	}
	// A file the agent wrote but never staged is still a change it made.
	if got := fileNamed(t, changes.Files, "untracked.txt"); !got.Untracked || got.Additions != 2 {
		t.Fatalf("untracked file mis-measured: %+v", got)
	}
	if changes.Additions < 4 {
		t.Fatalf("totals do not add up: %+v", changes)
	}
}

func TestSessionFileDiffRendersAPatchForTrackedAndUntrackedFiles(t *testing.T) {
	mgr, id := changesFixture(t)
	tracked, err := mgr.SessionFileDiff(context.Background(), id, "keep.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(tracked.Patch, "+four") {
		t.Fatalf("tracked patch missing its edit: %q", tracked.Patch)
	}
	untracked, err := mgr.SessionFileDiff(context.Background(), id, "untracked.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(untracked.Patch, "+a") {
		t.Fatalf("untracked patch missing its content: %q", untracked.Patch)
	}
}

// The checkout is not a file server: only paths the change list reported can
// be read back through the diff command.
func TestSessionFileDiffRefusesPathsThatDidNotChange(t *testing.T) {
	mgr, id := changesFixture(t)
	if _, err := mgr.SessionFileDiff(context.Background(), id, "../../etc/passwd"); err == nil {
		t.Fatal("an unrelated path must be refused")
	}
	if _, err := mgr.SessionFileDiff(context.Background(), id, "README"); err == nil {
		t.Fatal("an unchanged path must be refused")
	}
}

func TestSessionChangesExplainsACheckoutThatIsNotARepository(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	mgr := NewManager(st, func(string, ...any) {}, &fakeAdapter{})
	t.Cleanup(mgr.Shutdown)
	now := proto.NowMillis()
	if err := st.CreateSession(context.Background(), store.SessionMeta{ID: "s2", Cwd: t.TempDir(), Harness: "fake", CreatedAt: now, UpdatedAt: now, Phase: "idle"}); err != nil {
		t.Fatal(err)
	}
	changes, err := mgr.SessionChanges(context.Background(), "s2")
	if err != nil {
		t.Fatalf("a plain directory must not be an error: %v", err)
	}
	if changes.Warning == "" || len(changes.Files) != 0 {
		t.Fatalf("expected an explained empty list: %+v", changes)
	}
}
