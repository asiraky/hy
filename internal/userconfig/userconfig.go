// Package userconfig holds per-machine preferences that deliberately do not
// belong in a repo. Project settings live in .hy/project.json and are shared
// with whoever clones the project; the things here are the operator's own
// habits, so they live beside the database in ~/.hy instead.
package userconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// DefaultBranchFormat turns a `gh issue list` row into a branch name. It ships
// as the default so the suggestion list works before anyone opens settings; it
// is a string rather than Go code because the presenter is what evaluates it.
const DefaultBranchFormat = "(issue) => `issue/${issue.number}-${issue.title.toLowerCase().replace(/[^a-z0-9]+/g, \"-\").replace(/^-+|-+$/g, \"\").slice(0, 40).replace(/-+$/, \"\")}`"

type Config struct {
	Version int `json:"version"`
	// BranchFormat is a JavaScript arrow function, object in and string out,
	// evaluated by the web UI to name a new worktree. Empty means the default.
	BranchFormat string `json:"branchFormat,omitempty"`
	// SuggestIssues disables the `gh` lookup for people who do not use it.
	SuggestIssues *bool `json:"suggestIssues,omitempty"`
}

func Default() Config {
	return Config{Version: 1, BranchFormat: DefaultBranchFormat}
}

// Path is ~/.hy/config.json, beside hy.db.
func Path() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".hy", "config.json"), nil
}

func Normalize(cfg Config) (Config, error) {
	if cfg.Version == 0 {
		cfg.Version = 1
	}
	if cfg.Version != 1 {
		return cfg, fmt.Errorf("unsupported user config version %d", cfg.Version)
	}
	if strings.TrimSpace(cfg.BranchFormat) == "" {
		cfg.BranchFormat = DefaultBranchFormat
	}
	return cfg, nil
}

// Load never fails on a missing file: an operator who has never opened settings
// still gets working suggestions.
func Load() (Config, error) {
	cfg := Default()
	path, err := Path()
	if err != nil {
		return cfg, err
	}
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(b, &cfg); err != nil {
		return Default(), fmt.Errorf("parse %s: %w", path, err)
	}
	return Normalize(cfg)
}

// Save writes atomically, matching project.Save, so a crash mid-write cannot
// leave a half-parsed config that breaks every later session.
func Save(cfg Config) (Config, error) {
	cfg, err := Normalize(cfg)
	if err != nil {
		return cfg, err
	}
	path, err := Path()
	if err != nil {
		return cfg, err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return cfg, err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return cfg, err
	}
	tmp, err := os.CreateTemp(dir, "config-*.json")
	if err != nil {
		return cfg, err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err := tmp.Write(append(b, '\n')); err != nil {
		tmp.Close()
		return cfg, err
	}
	if err := tmp.Close(); err != nil {
		return cfg, err
	}
	if err := os.Chmod(name, 0o600); err != nil {
		return cfg, err
	}
	return cfg, os.Rename(name, path)
}
