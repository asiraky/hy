package claudecode

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The sidecar spawns a several-hundred-megabyte harness process. If the host
// dies without cleaning up, both are orphaned and keep running invisibly,
// holding a session. The bridge's defence is stdin EOF: when the host's end of
// the pipe closes — including a SIGKILL, where no handler of ours would run —
// the sidecar exits and takes the harness with it.
//
// This test kills a stand-in host the hardest way available and asserts
// nothing survives.
func TestSidecarDiesWithItsHost(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("process-group semantics differ on windows")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}

	dir := t.TempDir()
	script := filepath.Join(dir, "sidecar.mjs")
	data, err := sidecarFS.ReadFile("sidecar/sidecar.mjs")
	if err != nil {
		t.Fatal(err)
	}

	// Replace the SDK import with a stub that spawns a long-lived child, so
	// the lifecycle is exercised without needing the SDK or an account.
	stubbed := strings.Replace(string(data),
		`import { query } from "@anthropic-ai/claude-agent-sdk";`,
		`import { spawn as __spawn } from "node:child_process";
const __child = __spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
const query = () => ({
  async *[Symbol.asyncIterator]() { await new Promise(() => {}); },
  interrupt: async () => {},
  setModel: async () => {},
});`, 1)
	if stubbed == string(data) {
		t.Fatal("could not stub the SDK import; the sidecar's import line changed")
	}
	if err := os.WriteFile(script, []byte(stubbed), 0o644); err != nil {
		t.Fatal(err)
	}
	writeGuard(t, dir)

	cfg, _ := json.Marshal(sidecarConfig{Cwd: dir})

	// A stand-in host: spawns the sidecar exactly as the adapter does, then
	// reports the pids and waits to be killed.
	hostSrc := filepath.Join(dir, "host.mjs")
	host := `
import { spawn } from "node:child_process";
const child = spawn(process.argv[2], [process.argv[3], process.argv[4]], { stdio: ["pipe","pipe","ignore"] });
setTimeout(() => { process.stdout.write(JSON.stringify({ sidecar: child.pid }) + "\n"); }, 700);
setInterval(() => {}, 1000);
`
	if err := os.WriteFile(hostSrc, []byte(host), 0o644); err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command(node, hostSrc, node, script, string(cfg))
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()

	buf := make([]byte, 256)
	n, err := out.Read(buf)
	if err != nil {
		t.Fatalf("stand-in host produced no pids: %v", err)
	}
	var pids struct {
		Sidecar int `json:"sidecar"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(buf[:n]))), &pids); err != nil {
		t.Fatalf("parse pids from %q: %v", buf[:n], err)
	}

	grandchild := childOf(t, pids.Sidecar)
	if grandchild == 0 {
		t.Fatalf("sidecar %d spawned no harness process; the test is not exercising the tree", pids.Sidecar)
	}

	// The hardest kill available: no handler of the host's runs.
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if !alive(pids.Sidecar) && !alive(grandchild) {
			return // both gone
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Clean up whatever survived so a failure does not leak processes.
	for _, pid := range []int{pids.Sidecar, grandchild} {
		if alive(pid) {
			_ = syscallKill(pid)
		}
	}
	t.Fatalf("orphans survived the host: sidecar %d alive=%v, harness %d alive=%v",
		pids.Sidecar, alive(pids.Sidecar), grandchild, alive(grandchild))
}

func childOf(t *testing.T, ppid int) int {
	t.Helper()
	out, err := exec.Command("ps", "-eo", "pid,ppid").Output()
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(out), "\n")[1:] {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		if parent, _ := strconv.Atoi(fields[1]); parent == ppid {
			pid, _ := strconv.Atoi(fields[0])
			return pid
		}
	}
	return 0
}

func alive(pid int) bool {
	if pid == 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return p.Signal(nil) == nil
}

func syscallKill(pid int) error {
	p, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return p.Kill()
}
