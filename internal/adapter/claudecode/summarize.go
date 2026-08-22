package claudecode

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/asiraky/omniplex/internal/adapter"
)

// summaryModel is the fastest model Claude Code offers. It is named here
// rather than discovered because it is a family alias, not a dated id: it
// survives releases, and the picker deliberately hides Haiku (see isHaiku in
// models.go), so there is no live list to read it from. Summarising is the one
// job where the cheapest model is the right one.
const summaryModel = "haiku"

// summaryDeniedTools stops the summariser touching the machine. It is handed a
// transcript and asked for prose; a tool call would be a prompt injection from
// whatever the agent happened to read, and it would be slow. Claude Code has
// no "no tools at all" switch, so the built-ins are denied by name.
var summaryDeniedTools = strings.Join([]string{
	"Bash", "Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep",
	"WebFetch", "WebSearch", "Task", "TodoWrite",
	// Anything an MCP server contributes, whatever this machine happens to
	// have configured. Naming the built-ins alone would leave the operator's
	// own servers reachable from text the summariser was told to describe.
	"mcp__*",
}, ",")

// Summarize answers one question about a transcript and exits.
//
// It drives the Claude Code CLI directly in print mode rather than going
// through the sidecar. The sidecar exists to host the Agent SDK for a live,
// bidirectional session — permissions, tool calls, interrupts — and none of
// that applies to one non-interactive question. Going direct also means a
// summary works on a machine with no Node and no SDK installed, which is
// exactly the machine where the bundled build is running.
func (a *Adapter) Summarize(ctx context.Context, env map[string]string, req adapter.SummaryRequest) (adapter.SummaryResult, error) {
	var out adapter.SummaryResult

	claudePath, found := a.findClaude()
	if !found {
		return out, fmt.Errorf("Claude Code is not installed on this machine")
	}

	args := []string{
		"--print",
		"--model", summaryModel,
		"--output-format", "json",
		// --system-prompt replaces Claude Code's own preamble instead of
		// appending to it. The coding harness persona is irrelevant here and
		// costs both latency and tokens on every call.
		"--system-prompt", req.System,
		"--disallowed-tools", summaryDeniedTools,
		// Load no MCP servers at all: with no --mcp-config to go with it,
		// strict mode means the configured ones are never started. Denying
		// them by name is the second lock; this is the first.
		"--strict-mcp-config",
	}

	cmd := exec.CommandContext(ctx, claudePath, args...)
	// A neutral directory on purpose: run inside the session's checkout and
	// Claude Code loads that project's CLAUDE.md, settings, and MCP servers,
	// none of which should shape — or slow down — a summary.
	cmd.Dir = os.TempDir()
	cmd.Env = append(adapter.MergeEnv(os.Environ(), env), "CLAUDE_CODE_ENTRYPOINT=sdk-ts")
	cmd.Stdin = strings.NewReader(req.Transcript)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return out, fmt.Errorf("summarising with %s timed out", summaryModel)
		}
		return out, fmt.Errorf("claude --print failed: %w: %s", err, firstLine(strings.TrimSpace(stderr.String())))
	}

	// The envelope carries is_error rather than failing the process, so a
	// refusal or a model error looks like success unless it is read.
	var reply struct {
		Result  string `json:"result"`
		IsError bool   `json:"is_error"`
		Subtype string `json:"subtype"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &reply); err != nil {
		return out, fmt.Errorf("could not read the summary Claude returned: %w", err)
	}
	if reply.IsError {
		detail := strings.TrimSpace(reply.Result)
		if detail == "" {
			detail = reply.Subtype
		}
		return out, fmt.Errorf("claude could not summarise this session: %s", detail)
	}

	out.Text = strings.TrimSpace(reply.Result)
	out.Model = summaryModel
	return out, nil
}
