package session

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// The panel's file surfaces read the real filesystem, not git: git is the diff
// surface, and a file the session never touched is exactly what the diff
// cannot show. Everything here is scoped to the session's checkout, and the
// scoping is genuine — symlinks are resolved on both the root and the target
// and compared, rather than prefix-matching strings a symlink can lie about.

const (
	// A megabyte of source is more than any panel renders usefully; past it
	// the read is cut and flagged rather than shipped.
	maxFileReadBytes = 1024 * 1024
	// Enough entries for any tree a human browses by hand.
	maxTreeEntries = 20000
)

// FileTree is every path under a session's checkout, relative to its root.
type FileTree struct {
	Root  string   `json:"root"`
	Files []string `json:"files"`
	// Truncated marks a tree cut at maxTreeEntries.
	Truncated bool `json:"truncated,omitempty"`
	// Warning explains an empty list that is not simply "an empty checkout".
	Warning string `json:"warning,omitempty"`
}

// FileContent is one file's bytes, for the read-only viewer.
type FileContent struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Size    int64  `json:"size"`
	// Binary content is not sent: a NUL byte near the start means there is
	// nothing to show as text.
	Binary    bool `json:"binary,omitempty"`
	Truncated bool `json:"truncated,omitempty"`
}

// SessionFileTree lists the session's checkout. Inside a git repository the
// list respects .gitignore (tracked plus untracked-but-not-ignored, which is
// what a human means by "the files"); includeIgnored turns the filter off.
// Outside a repository it walks the directory with the same caps.
func (m *Manager) SessionFileTree(ctx context.Context, sessionID string, includeIgnored bool) (FileTree, error) {
	root, warning, err := m.workspaceRoot(ctx, sessionID)
	if err != nil {
		return FileTree{}, err
	}
	if warning != "" {
		return FileTree{Root: root, Files: []string{}, Warning: warning}, nil
	}

	files, truncated, err := listTree(ctx, root, includeIgnored)
	if err != nil {
		return FileTree{}, err
	}
	return FileTree{Root: root, Files: files, Truncated: truncated}, nil
}

// SessionReadFile reads one file inside the session's checkout. The path must
// resolve — through any symlinks — to somewhere under the checkout's own
// resolved root; anything else is refused.
func (m *Manager) SessionReadFile(ctx context.Context, sessionID, path string) (FileContent, error) {
	root, warning, err := m.workspaceRoot(ctx, sessionID)
	if err != nil {
		return FileContent{}, err
	}
	if warning != "" {
		return FileContent{}, fmt.Errorf("%s", warning)
	}

	abs, err := resolveInWorkspace(root, path)
	if err != nil {
		return FileContent{}, err
	}

	info, err := os.Stat(abs)
	if err != nil {
		return FileContent{}, fmt.Errorf("%q could not be read: %w", path, err)
	}
	if info.IsDir() {
		return FileContent{}, fmt.Errorf("%q is a directory", path)
	}

	f, err := os.Open(abs)
	if err != nil {
		return FileContent{}, err
	}
	defer f.Close()

	raw, err := io.ReadAll(io.LimitReader(f, maxFileReadBytes+1))
	if err != nil {
		return FileContent{}, err
	}
	out := FileContent{Path: path, Size: info.Size()}
	if out.Truncated = len(raw) > maxFileReadBytes; out.Truncated {
		raw = raw[:maxFileReadBytes]
	}

	// The same evidence git uses: a NUL byte near the start means binary.
	probe := raw
	if len(probe) > 8192 {
		probe = probe[:8192]
	}
	if bytes.IndexByte(probe, 0) >= 0 {
		out.Binary = true
		return out, nil
	}
	out.Content = string(raw)
	return out, nil
}

// SessionWorkspaceRoot is the directory a session's terminal (and any other
// workspace-scoped surface) starts in. Unlike the file surfaces it has no
// warning channel: a terminal with nowhere to run is an error.
func (m *Manager) SessionWorkspaceRoot(ctx context.Context, sessionID string) (string, error) {
	root, warning, err := m.workspaceRoot(ctx, sessionID)
	if err != nil {
		return "", err
	}
	if warning != "" {
		return "", fmt.Errorf("%s", warning)
	}
	return root, nil
}

// workspaceRoot is where a session's file surface is rooted: the git toplevel
// of its checkout when there is one, else the checkout directory itself. The
// warning mirrors diffScope's: an unusable root is an answer, not an error.
func (m *Manager) workspaceRoot(ctx context.Context, sessionID string) (root, warning string, err error) {
	meta, err := m.store.Session(ctx, sessionID)
	if err != nil {
		return "", "", err
	}
	if meta.Cwd == "" {
		return "", "this session has no checkout", nil
	}
	if top, gitErr := runGit(ctx, meta.Cwd, "rev-parse", "--show-toplevel"); gitErr == nil {
		return strings.TrimSpace(string(top)), "", nil
	}
	if _, statErr := os.Stat(meta.Cwd); statErr != nil {
		return "", "this session's directory does not exist", nil
	}
	return meta.Cwd, "", nil
}

// resolveInWorkspace turns a client-supplied relative path into an absolute
// one, proving on the way that it cannot leave the workspace. Both sides are
// symlink-resolved before comparison — a checkout is allowed to itself live
// behind a symlink (macOS /tmp does), and a symlink inside it must not be a
// door out.
func resolveInWorkspace(root, path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("a path is required")
	}
	if filepath.IsAbs(path) {
		return "", fmt.Errorf("%q is not a path inside this session's workspace", path)
	}

	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("the session workspace could not be resolved: %w", err)
	}

	joined := filepath.Join(realRoot, filepath.FromSlash(path))
	// Join cleans the path, but a cleaned path can still start with ".." —
	// catch it early so the error names the path, not a resolution failure.
	if rel, relErr := filepath.Rel(realRoot, joined); relErr != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%q is not a path inside this session's workspace", path)
	}

	// Resolve the target's own symlinks. The file itself may be a fresh
	// creation EvalSymlinks can still resolve; a missing file is reported as
	// missing by the read that follows, not here.
	real, err := filepath.EvalSymlinks(joined)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("%q does not exist in this session's workspace", path)
		}
		return "", err
	}
	if rel, relErr := filepath.Rel(realRoot, real); relErr != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%q resolves outside this session's workspace", path)
	}
	return real, nil
}

// listTree lists every file under root. Git does the ignoring when it can:
// `ls-files -co --exclude-standard` is tracked plus untracked-minus-ignored,
// which is the tree as a human pictures it.
func listTree(ctx context.Context, root string, includeIgnored bool) ([]string, bool, error) {
	if _, err := runGit(ctx, root, "rev-parse", "--show-toplevel"); err == nil && !includeIgnored {
		listed, err := runGit(ctx, root, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
		if err != nil {
			return nil, false, err
		}
		files := splitNUL(string(listed))
		// ls-files reports deleted-but-tracked paths too; a file surface must
		// not offer a file that is not there.
		out := files[:0]
		for _, f := range files {
			if _, statErr := os.Lstat(filepath.Join(root, f)); statErr == nil {
				out = append(out, f)
			}
		}
		sort.Strings(out)
		if len(out) > maxTreeEntries {
			return out[:maxTreeEntries], true, nil
		}
		return out, false, nil
	}
	return walkTree(root)
}

// walkTree is the fallback for a checkout git cannot list — not a repository,
// or the ignored files were asked for. It skips .git itself; nothing a person
// browses lives in there.
func walkTree(root string) ([]string, bool, error) {
	var out []string
	truncated := false
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			// An unreadable subdirectory is not a reason to show nothing.
			return nil
		}
		if d.IsDir() {
			if d.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		rel, relErr := filepath.Rel(root, p)
		if relErr != nil {
			return nil
		}
		if len(out) >= maxTreeEntries {
			truncated = true
			return filepath.SkipAll
		}
		out = append(out, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	sort.Strings(out)
	return out, truncated, nil
}
