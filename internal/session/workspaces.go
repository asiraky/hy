package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Workspace is one checkout a session could run in: the project root, or any
// worktree Git already knows about. hy does not care who created them — a
// worktree made by hand months ago is as attachable as one hy provisioned.
type Workspace struct {
	Path   string `json:"path"`
	Branch string `json:"branch,omitempty"`
	// Head is the short commit, shown for detached worktrees that have no branch.
	Head string `json:"head,omitempty"`
	// IsRoot marks the project root, which is always attachable and never removed.
	IsRoot bool `json:"isRoot,omitempty"`
	// Busy marks a workspace a live session already holds. Two harnesses editing
	// one checkout corrupt each other's work, so these are offered but disabled.
	Busy          bool   `json:"busy,omitempty"`
	BusySessionID string `json:"busySessionId,omitempty"`
	BusyTitle     string `json:"busyTitle,omitempty"`
	// Locked reports Git's own worktree lock, which blocks removal too.
	Locked bool `json:"locked,omitempty"`
}

// ListWorkspaces enumerates attachable checkouts for a project. A failure to
// run Git is not fatal: the project root is always attachable, so a non-repo
// directory still yields one usable entry.
func (m *Manager) ListWorkspaces(ctx context.Context, projectID string) ([]Workspace, error) {
	p, err := m.store.Project(ctx, projectID)
	if err != nil {
		return nil, err
	}
	root, err := filepath.Abs(p.Root)
	if err != nil {
		return nil, err
	}
	// Git reports resolved paths, so the configured root must be resolved too
	// or the project root fails to recognise itself behind a symlinked parent
	// — /var on macOS being the everyday case.
	root = canonicalPath(root)

	out := []Workspace{}
	listed, listErr := runGit(ctx, root, "worktree", "list", "--porcelain")
	if listErr != nil {
		out = append(out, Workspace{Path: root, IsRoot: true})
	} else {
		out = parseWorktreeList(string(listed), root)
	}

	sessions, err := m.store.ListSessions(ctx)
	if err != nil {
		return out, nil
	}
	holders := map[string]struct {
		id, title string
	}{}
	for _, s := range sessions {
		// A closed session has released its checkout; anything else may still
		// have a harness process with files open in it.
		if s.Phase == "closed" || s.Cwd == "" {
			continue
		}
		// A managed session's Cwd is only a placeholder until its worktree
		// exists, and the placeholder is the project root. Counting it would
		// report the root busy for the length of every provision, and forever
		// after one that failed. Local and borrowed sessions hold their
		// checkout from the moment they are created, because they never
		// move.
		if s.WorkspaceMode == "managed" && (s.Phase == "creating" || s.Phase == "provisioning" || s.Phase == "provision_failed") {
			continue
		}
		abs, absErr := filepath.Abs(s.Cwd)
		if absErr != nil {
			continue
		}
		abs = canonicalPath(abs)
		if _, taken := holders[abs]; taken {
			continue
		}
		title := s.Title
		if title == "" {
			title = "untitled session"
		}
		holders[abs] = struct{ id, title string }{s.ID, title}
	}
	for i := range out {
		if h, ok := holders[canonicalPath(out[i].Path)]; ok {
			out[i].Busy, out[i].BusySessionID, out[i].BusyTitle = true, h.id, h.title
		}
	}
	return out, nil
}

func parseWorktreeList(porcelain, root string) []Workspace {
	var out []Workspace
	var cur *Workspace
	flush := func() {
		if cur != nil {
			out = append(out, *cur)
			cur = nil
		}
	}
	for _, line := range strings.Split(porcelain, "\n") {
		line = strings.TrimRight(line, "\r")
		switch {
		case strings.HasPrefix(line, "worktree "):
			flush()
			path := strings.TrimPrefix(line, "worktree ")
			if abs, err := filepath.Abs(path); err == nil {
				path = abs
			}
			path = canonicalPath(path)
			cur = &Workspace{Path: path, IsRoot: path == root}
		case cur == nil:
			continue
		case strings.HasPrefix(line, "branch "):
			cur.Branch = strings.TrimPrefix(strings.TrimPrefix(line, "branch "), "refs/heads/")
		case strings.HasPrefix(line, "HEAD "):
			head := strings.TrimPrefix(line, "HEAD ")
			if len(head) > 8 {
				head = head[:8]
			}
			cur.Head = head
		case line == "locked" || strings.HasPrefix(line, "locked "):
			cur.Locked = true
		}
	}
	flush()
	return out
}

// ResolveWorkspace validates a path the presenter asked to attach to. Attach is
// deliberately not "run the agent anywhere": the path must be a checkout Git
// reports for this project, which keeps a stale or hostile client from pointing
// a harness at an arbitrary directory.
func (m *Manager) ResolveWorkspace(ctx context.Context, projectID, path string) (Workspace, error) {
	if strings.TrimSpace(path) == "" {
		return Workspace{}, errors.New("workspace path is empty")
	}
	spaces, err := m.ListWorkspaces(ctx, projectID)
	if err != nil {
		return Workspace{}, err
	}
	target, err := filepath.Abs(path)
	if err != nil {
		return Workspace{}, err
	}
	target = canonicalPath(target)
	for _, w := range spaces {
		if canonicalPath(w.Path) != target {
			continue
		}
		if info, statErr := os.Stat(w.Path); statErr != nil || !info.IsDir() {
			return Workspace{}, fmt.Errorf("%s is no longer a directory", w.Path)
		}
		if w.Busy {
			return Workspace{}, fmt.Errorf("%s is already in use by %q", filepath.Base(w.Path), w.BusyTitle)
		}
		return w, nil
	}
	return Workspace{}, fmt.Errorf("%s is not a worktree of this project", path)
}

// Issue is one row of `gh issue list`, passed through to the presenter verbatim
// so the operator's own format function decides which fields matter.
type Issue struct {
	Number int             `json:"number"`
	Title  string          `json:"title"`
	URL    string          `json:"url,omitempty"`
	Labels []issueLabel    `json:"labels,omitempty"`
	Assign json.RawMessage `json:"assignees,omitempty"`
}

type issueLabel struct {
	Name string `json:"name"`
}

const issueLookupTimeout = 12 * time.Second

// ListIssues asks the GitHub CLI for open issues to seed branch-name
// suggestions. Every failure here is soft: gh missing, unauthenticated, or the
// project simply not being a GitHub repo are all ordinary, and none of them
// should stop someone typing a branch name by hand.
func (m *Manager) ListIssues(ctx context.Context, projectID string) ([]Issue, string) {
	p, err := m.store.Project(ctx, projectID)
	if err != nil {
		return nil, err.Error()
	}
	if _, err := exec.LookPath("gh"); err != nil {
		return nil, "the GitHub CLI (gh) is not installed"
	}
	ctx, cancel := context.WithTimeout(ctx, issueLookupTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "gh", "issue", "list",
		"--state", "open", "--limit", "30", "--json", "number,title,url,labels,assignees")
	cmd.Dir = p.Root
	out, err := cmd.Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) && len(ee.Stderr) > 0 {
			return nil, strings.TrimSpace(string(ee.Stderr))
		}
		if ctx.Err() != nil {
			return nil, "gh issue list timed out"
		}
		return nil, err.Error()
	}
	var issues []Issue
	if err := json.Unmarshal(out, &issues); err != nil {
		return nil, "could not parse gh output: " + err.Error()
	}
	return issues, ""
}

// canonicalPath resolves symlinks where it can and otherwise answers with what
// it was given: a path that does not exist yet is still worth comparing.
func canonicalPath(path string) string {
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return resolved
	}
	return path
}

func runGit(ctx context.Context, dir string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	return cmd.Output()
}
