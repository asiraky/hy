package main

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/asiraky/omniplex/internal/provider"
	"github.com/asiraky/omniplex/internal/userconfig"
)

func TestClaudeConfigDirsResolvesSensitiveProviderOverride(t *testing.T) {
	secrets, err := provider.OpenSecretStoreAt(filepath.Join(t.TempDir(), "secrets"))
	if err != nil {
		t.Fatal(err)
	}
	if err := secrets.Put("claude-work", "CLAUDE_CONFIG_DIR", "/secure/claude-work"); err != nil {
		t.Fatal(err)
	}
	cfg := userconfig.Default()
	cfg.Providers = []json.RawMessage{json.RawMessage(`{
        "id":"claude-work",
        "driver":"claude",
        "env":[{"name":"CLAUDE_CONFIG_DIR","sensitive":true}]
    }`)}
	dirs, err := claudeConfigDirsFrom(cfg, secrets)
	if err != nil {
		t.Fatal(err)
	}
	if dirs["claude-work"] != "/secure/claude-work" {
		t.Fatalf("config dir = %q", dirs["claude-work"])
	}
}
