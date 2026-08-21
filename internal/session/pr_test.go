package session

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/asiraky/hy/internal/proto"
	"github.com/asiraky/hy/internal/store"
)

// fakeGh puts a `gh` on PATH ahead of any real one. The script writes the
// arguments it was handed to argsFile, so a test can assert what was asked as
// well as what came back.
func fakeGh(t *testing.T, stdout, stderr string, exit int) (argsFile string) {
	t.Helper()
	dir := t.TempDir()
	argsFile = filepath.Join(dir, "args")
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + argsFile + "\n"
	if stderr != "" {
		script += "printf '%s' " + shellQuote(stderr) + " >&2\n"
	}
	if stdout != "" {
		script += "printf '%s' " + shellQuote(stdout) + "\n"
	}
	script += "exit " + strconv.Itoa(exit) + "\n"
	if err := os.WriteFile(filepath.Join(dir, "gh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return argsFile
}

func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// prSession registers a session the PR lookup will accept, in a directory that
// exists, so only the thing under test decides the outcome.
func prSession(t *testing.T, mode, branch string) *Manager {
	t.Helper()
	root, worktree, _ := gitRepo(t)
	st, p := testProject(t, root)
	now := proto.NowMillis()
	err := st.CreateSession(context.Background(), store.SessionMeta{
		ID: "s1", Cwd: worktree, Harness: "fake", Title: "t",
		CreatedAt: now, UpdatedAt: now, Phase: "idle",
		ProjectID: p.ID, Branch: branch, WorkspaceMode: mode,
	})
	if err != nil {
		t.Fatal(err)
	}
	mgr := NewManager(st, func(string, ...any) {}, &fakeAdapter{})
	t.Cleanup(mgr.Shutdown)
	return mgr
}

func TestParsePRCallsAPullRequestMergedOnlyWithBothStateAndTimestamp(t *testing.T) {
	cases := []struct {
		name string
		json string
		want bool
	}{
		{"merged", `{"number":7,"state":"MERGED","mergedAt":"2026-08-20T01:02:03Z"}`, true},
		{"lowercase state", `{"number":7,"state":"merged","mergedAt":"2026-08-20T01:02:03Z"}`, true},
		{"open", `{"number":7,"state":"OPEN","mergedAt":""}`, false},
		{"closed unmerged", `{"number":7,"state":"CLOSED","mergedAt":""}`, false},
		{"state without timestamp", `{"number":7,"state":"MERGED","mergedAt":""}`, false},
		{"timestamp without state", `{"number":7,"state":"CLOSED","mergedAt":"2026-08-20T01:02:03Z"}`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pr, reason := parsePR([]byte(c.json))
			if reason != "" {
				t.Fatalf("unexpected reason %q", reason)
			}
			if pr.Merged != c.want {
				t.Fatalf("merged = %v, want %v", pr.Merged, c.want)
			}
		})
	}
}

func TestParsePRRefusesOutputWithNoPullRequestInIt(t *testing.T) {
	if _, reason := parsePR([]byte(`{}`)); reason == "" {
		t.Fatal("an empty object must not pass as a pull request")
	}
	if _, reason := parsePR([]byte(`not json`)); reason == "" {
		t.Fatal("unparseable output must not pass as a pull request")
	}
}

func TestSessionPRAsksGhAboutTheSessionsOwnBranch(t *testing.T) {
	argsFile := fakeGh(t, `{"number":75,"title":"Prompt","url":"https://example/75","state":"MERGED","mergedAt":"2026-08-20T01:02:03Z"}`, "", 0)
	mgr := prSession(t, "managed", "issue/75-prompt")

	pr, reason := mgr.SessionPR(context.Background(), "s1")
	if reason != "" {
		t.Fatalf("unexpected reason %q", reason)
	}
	if pr == nil || pr.Number != 75 || !pr.Merged {
		t.Fatalf("merged pull request not reported: %+v", pr)
	}
	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(args), "issue/75-prompt") {
		t.Fatalf("gh was not asked about the session branch: %q", args)
	}
}

func TestSessionPRSaysNothingForALocalSession(t *testing.T) {
	fakeGh(t, `{"number":75,"state":"MERGED","mergedAt":"2026-08-20T01:02:03Z"}`, "", 0)
	mgr := prSession(t, "local", "main")

	pr, reason := mgr.SessionPR(context.Background(), "s1")
	if pr != nil {
		t.Fatalf("a local session has no worktree to reclaim: %+v", pr)
	}
	if reason == "" {
		t.Fatal("the refusal must say why")
	}
}

func TestSessionPRSaysNothingForASessionWithNoBranch(t *testing.T) {
	fakeGh(t, `{"number":75,"state":"MERGED","mergedAt":"2026-08-20T01:02:03Z"}`, "", 0)
	mgr := prSession(t, "managed", "")

	if pr, reason := mgr.SessionPR(context.Background(), "s1"); pr != nil || reason == "" {
		t.Fatalf("pr = %+v, reason = %q", pr, reason)
	}
}

func TestSessionPRTreatsAGhFailureAsSimplyNotKnowing(t *testing.T) {
	fakeGh(t, "", "no pull requests found for branch \"issue/75-prompt\"", 1)
	mgr := prSession(t, "borrowed", "issue/75-prompt")

	pr, reason := mgr.SessionPR(context.Background(), "s1")
	if pr != nil {
		t.Fatalf("a missing pull request is not a pull request: %+v", pr)
	}
	if !strings.Contains(reason, "no pull requests found") {
		t.Fatalf("gh's own words should survive: %q", reason)
	}
}
