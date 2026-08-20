package provider

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseDefaultsAndOpenDriver(t *testing.T) {
	inst, err := Parse(json.RawMessage(`{"id":"codex-personal","driver":"codex","env":[{"name":"CODEX_HOME","value":"/home/x/.codex-personal"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if !inst.Enabled {
		t.Error("enabled should default to true")
	}
	if inst.DisplayName != "codex-personal" {
		t.Errorf("display name should default to the id, got %q", inst.DisplayName)
	}

	// The driver is an open slug: a value this build has never heard of must
	// still parse, so a config from another branch cannot brick startup.
	if _, err := Parse(json.RawMessage(`{"id":"local","driver":"ollama"}`)); err != nil {
		t.Errorf("unknown driver must parse: %v", err)
	}

	if _, err := Parse(json.RawMessage(`{"driver":"codex"}`)); err == nil {
		t.Error("a missing id must be rejected: nothing could route to the instance")
	}
	if _, err := Parse(json.RawMessage(`{"id":"../evil","driver":"codex"}`)); err == nil {
		t.Error("a path-shaped id must be rejected")
	}
}

func TestLoadInstancesSweepsSensitiveValuesIntoSecretStore(t *testing.T) {
	secrets, err := OpenSecretStoreAt(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	raw := []json.RawMessage{json.RawMessage(`{"id":"claude-work","driver":"claude","futureKnob":{"a":1},"env":[{"name":"CLAUDE_CODE_OAUTH_TOKEN","value":"sk-secret","sensitive":true},{"name":"CLAUDE_CONFIG_DIR","value":"/tmp/claude-work"}]}`)}

	instances, rewritten, changed, err := LoadInstances(raw, secrets, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("a literal sensitive value must trigger a config rewrite")
	}
	if got, ok := secrets.Get("claude-work", "CLAUDE_CODE_OAUTH_TOKEN"); !ok || got != "sk-secret" {
		t.Fatalf("secret not swept into the store: %q %v", got, ok)
	}
	if strings.Contains(string(rewritten[0]), "sk-secret") {
		t.Error("the rewritten config must not hold the secret value")
	}
	if !strings.Contains(string(rewritten[0]), "futureKnob") {
		t.Error("keys this build does not know must round-trip")
	}

	// Materialisation puts the secret back at spawn time, and keeps the
	// non-secret pointer as an ordinary value.
	overlay, err := instances[0].EnvOverlay(secrets)
	if err != nil {
		t.Fatal(err)
	}
	if overlay["CLAUDE_CODE_OAUTH_TOKEN"] != "sk-secret" {
		t.Errorf("overlay should materialise the secret, got %q", overlay["CLAUDE_CODE_OAUTH_TOKEN"])
	}
	if overlay["CLAUDE_CONFIG_DIR"] != "/tmp/claude-work" {
		t.Errorf("overlay should carry plain values, got %q", overlay["CLAUDE_CONFIG_DIR"])
	}

	// A second load of the rewritten config is a no-op: the value is gone.
	if _, _, changedAgain, err := LoadInstances(rewritten, secrets, nil); err != nil || changedAgain {
		t.Errorf("re-loading swept config must not change it again (changed=%v err=%v)", changedAgain, err)
	}
}

func TestLoadInstancesKeepsMalformedEntriesVerbatim(t *testing.T) {
	secrets, err := OpenSecretStoreAt(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	bad := json.RawMessage(`{"driver":"codex","note":"no id"}`)
	instances, rewritten, changed, err := LoadInstances([]json.RawMessage{bad}, secrets, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(instances) != 0 || changed {
		t.Fatalf("malformed entry must be skipped, not loaded: %v", instances)
	}
	if string(rewritten[0]) != string(bad) {
		t.Errorf("malformed entry must round-trip verbatim: %s", rewritten[0])
	}
}

func TestSecretStoreSyncDeletesClearedSecrets(t *testing.T) {
	root := t.TempDir()
	secrets, err := OpenSecretStoreAt(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := secrets.Put("codex-personal", "OPENAI_API_KEY", "sk-1"); err != nil {
		t.Fatal(err)
	}
	if err := secrets.Put("other-branch-instance", "TOKEN", "keepme"); err != nil {
		t.Fatal(err)
	}

	// Permissions: the store is 0700, each secret 0600.
	if info, _ := os.Stat(root); info.Mode().Perm() != 0o700 {
		t.Errorf("store dir mode = %v", info.Mode().Perm())
	}
	if info, _ := os.Stat(filepath.Join(root, "codex-personal", "OPENAI_API_KEY")); info.Mode().Perm() != 0o600 {
		t.Errorf("secret file mode = %v", info.Mode().Perm())
	}

	// The instance still exists but the variable is no longer sensitive:
	// clearing the flag is how a secret is deleted.
	inst := Instance{ID: "codex-personal", Driver: "codex", Env: []EnvVar{{Name: "OPENAI_API_KEY", Sensitive: false}}}
	if err := secrets.Sync([]Instance{inst}); err != nil {
		t.Fatal(err)
	}
	if _, ok := secrets.Get("codex-personal", "OPENAI_API_KEY"); ok {
		t.Error("cleared secret must be deleted")
	}
	// An instance the current config does not mention is left alone: it may
	// belong to a config another branch wrote.
	if _, ok := secrets.Get("other-branch-instance", "TOKEN"); !ok {
		t.Error("secrets of unmentioned instances must survive")
	}
}

func TestEnvOverlayFailsClosedOnMissingSecret(t *testing.T) {
	secrets, err := OpenSecretStoreAt(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	inst := Instance{ID: "x", Driver: "codex", Env: []EnvVar{{Name: "KEY", Sensitive: true}}}
	if _, err := inst.EnvOverlay(secrets); err == nil {
		t.Error("a sensitive var with no stored secret must be an error: omitting it would fall through to the ambient account")
	}
}
