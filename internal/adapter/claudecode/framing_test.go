package claudecode

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// The bridge's one hard rule is that nothing but framed JSON may reach stdout.
// A single stray console.log — ours, a dependency's, or a Node warning —
// desynchronises the host. The sidecar redirects console.* to stderr; this
// asserts that guard holds against the noisiest thing a library can do.
func TestSidecarKeepsStdoutClean(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}

	dir := t.TempDir()
	data, err := sidecarFS.ReadFile("sidecar/sidecar.mjs")
	if err != nil {
		t.Fatal(err)
	}

	// Stub the SDK with something that makes noise on every console channel
	// and then emits one legitimate message.
	stubbed := strings.Replace(string(data),
		`import { query } from "@anthropic-ai/claude-agent-sdk";`,
		`console.log("noise on stdout at import time");
console.warn("a deprecation warning");
console.error({ structured: "error" });
process.emitWarning("a node warning");
const query = () => ({
  async *[Symbol.asyncIterator]() {
    console.log("noise from inside the stream");
    yield { type: "system", subtype: "init", model: "test-model" };
  },
  interrupt: async () => {},
  setModel: async () => {},
});`, 1)
	if stubbed == string(data) {
		t.Fatal("could not stub the SDK import; the sidecar's import line changed")
	}

	script := filepath.Join(dir, "sidecar.mjs")
	if err := os.WriteFile(script, []byte(stubbed), 0o644); err != nil {
		t.Fatal(err)
	}
	writeGuard(t, dir)

	cfg, _ := json.Marshal(sidecarConfig{Cwd: dir})
	out, _ := exec.Command(node, script, string(cfg)).Output() // stderr discarded on purpose

	lines := 0
	for _, line := range strings.Split(string(out), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		lines++
		var frame map[string]any
		if err := json.Unmarshal([]byte(line), &frame); err != nil {
			t.Fatalf("stdout carried an unframed line: %q\n\n"+
				"Every write to stdout must be framed JSON, or the host loses "+
				"sync with the stream.", line)
		}
		if frame["jsonrpc"] != "2.0" {
			t.Fatalf("stdout carried a non-JSON-RPC frame: %q", line)
		}
	}
	if lines == 0 {
		t.Fatal("sidecar produced no frames at all")
	}
}

// A payload can never split a frame: JSON escapes newlines, so one message is
// always exactly one line no matter what the harness emitted.
func TestFramingSurvivesEmbeddedNewlines(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}

	dir := t.TempDir()
	data, _ := sidecarFS.ReadFile("sidecar/sidecar.mjs")
	stubbed := strings.Replace(string(data),
		`import { query } from "@anthropic-ai/claude-agent-sdk";`,
		`const query = () => ({
  async *[Symbol.asyncIterator]() {
    yield { type: "assistant", text: "line one\nline two\r\nline three\n\n", blob: "}\n{\"jsonrpc\":\"2.0\"" };
  },
  interrupt: async () => {},
  setModel: async () => {},
});`, 1)

	script := filepath.Join(dir, "sidecar.mjs")
	if err := os.WriteFile(script, []byte(stubbed), 0o644); err != nil {
		t.Fatal(err)
	}
	writeGuard(t, dir)

	cfg, _ := json.Marshal(sidecarConfig{Cwd: dir})
	out, _ := exec.Command(node, script, string(cfg)).Output()

	var messages int
	for _, line := range strings.Split(string(out), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		// Frames differ in shape (params.message is an object for relayed
		// messages, a string for fatal), so decode loosely and inspect.
		var frame struct {
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.Unmarshal([]byte(line), &frame); err != nil {
			t.Fatalf("newline-bearing payload split a frame: %q", line)
		}
		if frame.Method != "message" {
			continue
		}
		var relayed struct {
			Message struct {
				Text string `json:"text"`
			} `json:"message"`
		}
		if err := json.Unmarshal(frame.Params, &relayed); err != nil {
			t.Fatalf("relayed frame did not decode: %q", line)
		}
		messages++
		if !strings.Contains(relayed.Message.Text, "line two") {
			t.Fatalf("payload was mangled in transit: %q", relayed.Message.Text)
		}
	}
	if messages != 1 {
		t.Fatalf("expected exactly 1 relayed message, got %d", messages)
	}
}

// writeGuard copies the stdout guard next to a stubbed sidecar, since the
// sidecar imports it by relative path.
func writeGuard(t *testing.T, dir string) {
	t.Helper()
	guard, err := sidecarFS.ReadFile("sidecar/guard.mjs")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "guard.mjs"), guard, 0o644); err != nil {
		t.Fatal(err)
	}
}
