package claudecode

import (
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
