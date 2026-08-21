package claudecode

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/asiraky/hy/internal/adapter"
)

type claudeCommand struct {
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	ArgumentHint string   `json:"argumentHint"`
	Aliases      []string `json:"aliases"`
}

func (s *session) ComposerItems(ctx context.Context) ([]adapter.ComposerItem, error) {
	var response struct {
		Commands []claudeCommand `json:"commands"`
	}
	if err := s.conn.Call(ctx, "supportedCommands", map[string]any{}, &response); err != nil {
		return nil, err
	}
	origins := discoverClaudeSkillOrigins(s.configDir, s.cwd)
	items := make([]adapter.ComposerItem, 0, len(response.Commands))
	seen := make(map[string]bool)
	for _, command := range response.Commands {
		name := strings.TrimSpace(command.Name)
		key := strings.ToLower(name)
		if name == "" || seen[key] {
			continue
		}
		seen[key] = true
		kind, origin := "command", "built-in"
		if skillOrigin, ok := origins[key]; ok {
			kind, origin = "skill", skillOrigin
		} else if inferred, ok := claudeDescriptionOrigin(command.Description); ok {
			kind, origin = "skill", inferred
		}
		items = append(items, adapter.ComposerItem{
			ID:          kind + ":" + name,
			Name:        name,
			Description: strings.TrimSpace(command.Description),
			Kind:        kind,
			Trigger:     "/",
			InsertText:  "/" + name,
			ArgsHint:    strings.TrimSpace(command.ArgumentHint),
			Origin:      origin,
			Behavior:    adapter.ComposerPrompt,
			Aliases:     command.Aliases,
		})
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	return items, nil
}

func claudeConfigDir(cwd string, env map[string]string) string {
	configured, overridden := env["CLAUDE_CONFIG_DIR"]
	if !overridden {
		configured = os.Getenv("CLAUDE_CONFIG_DIR")
	}
	if configured = strings.TrimSpace(configured); configured != "" {
		if filepath.IsAbs(configured) {
			return filepath.Clean(configured)
		}
		return filepath.Join(cwd, configured)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(cwd, ".claude")
	}
	return filepath.Join(home, ".claude")
}

// discoverClaudeSkillOrigins mirrors Claude's user/project roots only to
// enrich the SDK's authoritative command list. A missing or malformed file is
// skipped; discovery failure must never hide a command the provider reported.
func discoverClaudeSkillOrigins(configDir, cwd string) map[string]string {
	type root struct{ path, origin string }
	roots := []root{{filepath.Join(configDir, "skills"), "personal"}}
	if home, err := os.UserHomeDir(); err == nil {
		// Claude also follows the cross-provider Agent Skills user root.
		roots = append(roots, root{filepath.Join(home, ".agents", "skills"), "personal"})
	}
	if cwd != "" {
		roots = append(roots,
			root{filepath.Join(cwd, ".agents", "skills"), "project"},
			root{filepath.Join(cwd, ".claude", "skills"), "project"},
		)
	}
	origins := discoverClaudePluginOrigins(configDir, cwd)
	for _, root := range roots {
		entries, err := os.ReadDir(root.path)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			skillFile := filepath.Join(root.path, entry.Name(), "SKILL.md")
			f, err := os.Open(skillFile)
			if err != nil {
				continue
			}
			name := skillFrontmatterName(f, entry.Name())
			_ = f.Close()
			if name != "" {
				// Later project roots win, matching Claude's precedence.
				origins[strings.ToLower(name)] = root.origin
			}
		}
	}
	return origins
}

// Claude records the install paths and scopes of installed plugins. The SDK
// remains authoritative about which commands are actually available; these
// paths are consulted only when a returned name needs an origin label.
func discoverClaudePluginOrigins(configDir, cwd string) map[string]string {
	data, err := os.ReadFile(filepath.Join(configDir, "plugins", "installed_plugins.json"))
	if err != nil {
		return map[string]string{}
	}
	var installed struct {
		Plugins map[string][]struct {
			Scope       string `json:"scope"`
			ProjectPath string `json:"projectPath"`
			InstallPath string `json:"installPath"`
		} `json:"plugins"`
	}
	if json.Unmarshal(data, &installed) != nil {
		return map[string]string{}
	}

	origins := make(map[string]string)
	seenPaths := make(map[string]bool)
	for _, copies := range installed.Plugins {
		for _, plugin := range copies {
			if !claudePluginApplies(plugin.Scope, plugin.ProjectPath, cwd) {
				continue
			}
			installPath := filepath.Clean(plugin.InstallPath)
			if installPath == "." || seenPaths[installPath] {
				continue
			}
			seenPaths[installPath] = true
			discoverClaudeSkillRoot(filepath.Join(installPath, "skills"), "plugin", origins)
			discoverClaudeCommandRoot(filepath.Join(installPath, "commands"), "plugin", origins)
		}
	}
	return origins
}

func claudePluginApplies(scope, projectPath, cwd string) bool {
	if scope == "user" {
		return true
	}
	if scope != "project" && scope != "local" {
		return false
	}
	projectPath, cwd = filepath.Clean(projectPath), filepath.Clean(cwd)
	if projectPath == "." || cwd == "." {
		return false
	}
	rel, err := filepath.Rel(projectPath, cwd)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func discoverClaudeSkillRoot(path, origin string, origins map[string]string) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		f, err := os.Open(filepath.Join(path, entry.Name(), "SKILL.md"))
		if err != nil {
			continue
		}
		name := skillFrontmatterName(f, entry.Name())
		_ = f.Close()
		if name != "" {
			origins[strings.ToLower(name)] = origin
		}
	}
}

func discoverClaudeCommandRoot(path, origin string, origins map[string]string) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".md") {
			continue
		}
		fallback := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		f, err := os.Open(filepath.Join(path, entry.Name()))
		if err != nil {
			continue
		}
		name := skillFrontmatterName(f, fallback)
		_ = f.Close()
		if name != "" {
			origins[strings.ToLower(name)] = origin
		}
	}
}

// Current Claude Code appends source labels to discovered skill descriptions.
// They are fallback enrichment only: a matching filesystem entry above is
// preferred because this presentation suffix is not part of the SDK type.
func claudeDescriptionOrigin(description string) (string, bool) {
	description = strings.TrimSpace(description)
	switch {
	case strings.HasSuffix(description, "(user)"):
		return "personal", true
	case strings.HasSuffix(description, "(project)"), strings.HasSuffix(description, "(local)"):
		return "project", true
	case strings.HasSuffix(description, "(dynamic workflow)"):
		return "other", true
	default:
		return "", false
	}
}

func skillFrontmatterName(f *os.File, fallback string) string {
	scanner := bufio.NewScanner(f)
	if !scanner.Scan() || strings.TrimSpace(scanner.Text()) != "---" {
		return strings.TrimSpace(fallback)
	}
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "---" {
			break
		}
		key, value, ok := strings.Cut(line, ":")
		if ok && strings.TrimSpace(key) == "name" {
			return strings.Trim(strings.TrimSpace(value), `"'`)
		}
	}
	return strings.TrimSpace(fallback)
}
