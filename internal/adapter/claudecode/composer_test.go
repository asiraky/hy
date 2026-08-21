package claudecode

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDiscoverClaudeSkillOrigins(t *testing.T) {
	root := t.TempDir()
	config := filepath.Join(root, "config")
	cwd := filepath.Join(root, "repo")
	for _, file := range []struct{ path, body string }{
		{filepath.Join(config, "skills", "personal-name", "SKILL.md"), "---\nname: personal-name\n---\n"},
		{filepath.Join(cwd, ".agents", "skills", "folder-name", "SKILL.md"), "---\nname: project-name\n---\n"},
	} {
		if err := os.MkdirAll(filepath.Dir(file.path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file.path, []byte(file.body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	origins := discoverClaudeSkillOrigins(config, cwd)
	if origins["personal-name"] != "personal" {
		t.Fatalf("personal origin = %q", origins["personal-name"])
	}
	if origins["project-name"] != "project" {
		t.Fatalf("project origin = %q", origins["project-name"])
	}
}

func TestClaudeConfigDirUsesTheProcessEnvironment(t *testing.T) {
	ambient := filepath.Join(t.TempDir(), "ambient-claude")
	t.Setenv("CLAUDE_CONFIG_DIR", ambient)
	if got := claudeConfigDir(t.TempDir(), nil); got != ambient {
		t.Fatalf("config dir = %q, want inherited %q", got, ambient)
	}

	override := filepath.Join(t.TempDir(), "instance-claude")
	if got := claudeConfigDir(t.TempDir(), map[string]string{"CLAUDE_CONFIG_DIR": override}); got != override {
		t.Fatalf("config dir = %q, want instance override %q", got, override)
	}
}

func TestDiscoverClaudePluginOrigins(t *testing.T) {
	root := t.TempDir()
	config, cwd := filepath.Join(root, "config"), filepath.Join(root, "repo", "worktree")
	userPlugin := filepath.Join(root, "plugins", "user-plugin")
	projectPlugin := filepath.Join(root, "plugins", "project-plugin")
	for path, body := range map[string]string{
		filepath.Join(userPlugin, "skills", "folder", "SKILL.md"):          "---\nname: plugin-skill\n---\n",
		filepath.Join(userPlugin, "commands", "plugin-command.md"):         "---\nname: plugin-command\n---\n",
		filepath.Join(projectPlugin, "skills", "project-only", "SKILL.md"): "---\nname: project-plugin-skill\n---\n",
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	manifest := map[string]any{
		"version": 2,
		"plugins": map[string]any{
			"user@example": []map[string]string{{"scope": "user", "installPath": userPlugin}},
			"project@example": []map[string]string{{
				"scope": "project", "projectPath": filepath.Join(root, "repo"), "installPath": projectPlugin,
			}},
		},
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(config, "plugins", "installed_plugins.json")
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, data, 0o644); err != nil {
		t.Fatal(err)
	}

	origins := discoverClaudePluginOrigins(config, cwd)
	for _, name := range []string{"plugin-skill", "plugin-command", "project-plugin-skill"} {
		if origins[name] != "plugin" {
			t.Errorf("%s origin = %q, want plugin", name, origins[name])
		}
	}
}

func TestClaudeDescriptionOrigin(t *testing.T) {
	for _, test := range []struct{ description, want string }{
		{"Review a diff. (user)", "personal"},
		{"Run the repo workflow. (project)", "project"},
		{"Built in command", ""},
	} {
		got, _ := claudeDescriptionOrigin(test.description)
		if got != test.want {
			t.Errorf("origin(%q) = %q, want %q", test.description, got, test.want)
		}
	}
}
