package session

import (
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"strings"
	"time"
)

// PullRequest is the little hy knows about the pull request for a session's
// branch: enough to say "this landed" and link to it, and nothing more. It is
// never persisted — the answer is only true until someone merges something, so
// it is fetched on demand and thrown away.
type PullRequest struct {
	Number int    `json:"number"`
	Title  string `json:"title,omitempty"`
	URL    string `json:"url,omitempty"`
	// State is gh's own word: OPEN, MERGED or CLOSED.
	State  string `json:"state,omitempty"`
	Merged bool   `json:"merged,omitempty"`
	// MergedAt is RFC 3339, and empty for a pull request that never landed.
	MergedAt string `json:"mergedAt,omitempty"`
}

const prLookupTimeout = 12 * time.Second

// prFields is what `gh pr view` is asked for. Kept next to the struct that
// receives it so the two cannot drift apart unnoticed.
const prFields = "number,title,url,state,mergedAt"

// SessionPR reports the pull request for a session's branch, if there is one.
//
// Every failure is soft, and deliberately so: this exists to offer a cleanup
// affordance, so the cost of not knowing is that the affordance stays hidden.
// gh missing, gh unauthenticated, no remote, a remote that is not GitHub, or
// simply no pull request yet are all ordinary states of a perfectly healthy
// session, and none of them is worth an error in front of the user. The second
// return is a reason, for logs and for anyone debugging why no prompt appeared.
func (m *Manager) SessionPR(ctx context.Context, sessionID string) (*PullRequest, string) {
	meta, err := m.store.Session(ctx, sessionID)
	if err != nil {
		return nil, err.Error()
	}
	// A local session runs in the user's own checkout. There is no worktree to
	// reclaim, so a merged pull request tells hy nothing it should act on.
	if meta.WorkspaceMode != "managed" && meta.WorkspaceMode != "borrowed" {
		return nil, "not a worktree session"
	}
	if meta.Branch == "" {
		return nil, "session has no branch"
	}
	if meta.Cwd == "" {
		return nil, "session has no working directory"
	}
	if _, err := exec.LookPath("gh"); err != nil {
		return nil, "the GitHub CLI (gh) is not installed"
	}

	ctx, cancel := context.WithTimeout(ctx, prLookupTimeout)
	defer cancel()
	// The branch is passed explicitly rather than letting gh infer it from
	// HEAD: the worktree may well be checked out somewhere else by now, and
	// the session's branch is the thing being asked about either way.
	cmd := exec.CommandContext(ctx, "gh", "pr", "view", meta.Branch, "--json", prFields)
	cmd.Dir = meta.Cwd
	out, err := cmd.Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) && len(ee.Stderr) > 0 {
			return nil, strings.TrimSpace(string(ee.Stderr))
		}
		if ctx.Err() != nil {
			return nil, "gh pr view timed out"
		}
		return nil, err.Error()
	}
	pr, parseErr := parsePR(out)
	if parseErr != "" {
		return nil, parseErr
	}
	return pr, ""
}

// parsePR turns `gh pr view --json` output into a PullRequest. Merged is
// decided by both the state and the timestamp: either one alone has been
// enough to mislead — a closed-then-reopened pull request keeps a mergedAt in
// some views — and requiring both makes the false positive, the one that
// offers to delete a worktree still being worked in, the unlikely direction.
func parsePR(out []byte) (*PullRequest, string) {
	var pr PullRequest
	if err := json.Unmarshal(out, &pr); err != nil {
		return nil, "could not parse gh output: " + err.Error()
	}
	if pr.Number == 0 {
		return nil, "gh reported no pull request"
	}
	pr.Merged = strings.EqualFold(pr.State, "MERGED") && pr.MergedAt != ""
	return &pr, ""
}
