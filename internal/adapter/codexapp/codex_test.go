package codexapp

import (
	"context"
	"encoding/json"
	"io"
	"sync"
	"testing"

	"github.com/asiraky/hy/internal/adapter"
	"github.com/asiraky/hy/internal/jsonrpc"
)

// serverConn pairs a client jsonrpc.Conn with an in-memory server whose handler
// records the last request it saw and replies with the given result.
type recorder struct {
	mu     sync.Mutex
	method string
	params json.RawMessage
}

func (r *recorder) last() (string, json.RawMessage) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.method, r.params
}

func pairedConn(t *testing.T, reply map[string]any) (*jsonrpc.Conn, *recorder) {
	t.Helper()
	rec := &recorder{}
	// client writes -> server reads; server writes -> client reads.
	sr, cw := io.Pipe()
	cr, sw := io.Pipe()
	handler := func(_ context.Context, method string, params json.RawMessage) (any, error) {
		rec.mu.Lock()
		rec.method = method
		rec.params = params
		rec.mu.Unlock()
		if r, ok := reply[method]; ok {
			return r, nil
		}
		return map[string]any{}, nil
	}
	_ = jsonrpc.NewConn(sr, sw, handler, nil)
	client := jsonrpc.NewConn(cr, cw, nil, nil)
	t.Cleanup(func() { _ = cw.Close(); _ = sw.Close() })
	return client, rec
}

// TestPromptCapturesServerTurnIDForCancel guards the fix for the ChatGPT stop
// button: turn/start returns codex's turn id, and turn/interrupt must carry both
// threadId and that turnId or it is a silent no-op.
func TestPromptCapturesServerTurnIDForCancel(t *testing.T) {
	conn, rec := pairedConn(t, map[string]any{
		"turn/start": map[string]any{"turn": map[string]any{"id": "codex-turn-42"}},
	})
	s := &session{conn: conn, threadID: "thread-1"}

	if err := s.Prompt(context.Background(), adapter.PromptInput{TurnID: "hy-turn", Text: "hi"}); err != nil {
		t.Fatalf("Prompt: %v", err)
	}
	if s.serverTurnID != "codex-turn-42" {
		t.Fatalf("serverTurnID not captured: %q", s.serverTurnID)
	}

	if err := s.Cancel(context.Background()); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	method, params := rec.last()
	if method != "turn/interrupt" {
		t.Fatalf("Cancel sent %q, want turn/interrupt", method)
	}
	var got struct {
		ThreadID string `json:"threadId"`
		TurnID   string `json:"turnId"`
	}
	if err := json.Unmarshal(params, &got); err != nil {
		t.Fatal(err)
	}
	if got.ThreadID != "thread-1" || got.TurnID != "codex-turn-42" {
		t.Fatalf("turn/interrupt params = %+v, want thread-1 / codex-turn-42", got)
	}
}

// TestCancelWithoutActiveTurnIsNoop avoids sending an interrupt with an empty
// turn id, which codex rejects as invalid params.
func TestCancelWithoutActiveTurnIsNoop(t *testing.T) {
	conn, rec := pairedConn(t, nil)
	s := &session{conn: conn, threadID: "thread-1"}
	if err := s.Cancel(context.Background()); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if method, _ := rec.last(); method != "" {
		t.Fatalf("Cancel sent %q with no active turn, want nothing", method)
	}
}

type elicitHost struct {
	request adapter.ElicitationRequest
	result  adapter.ElicitationResult
}

func (h *elicitHost) RequestPermission(context.Context, adapter.PermissionRequest) (adapter.PermissionOutcome, error) {
	return adapter.PermissionOutcome{}, nil
}
func (h *elicitHost) Elicit(_ context.Context, req adapter.ElicitationRequest) (adapter.ElicitationResult, error) {
	h.request = req
	return h.result, nil
}
func (*elicitHost) Logf(string, ...any) {}

func TestRequestUserInputIsRoutedThroughDurableElicitation(t *testing.T) {
	host := &elicitHost{result: adapter.ElicitationResult{
		Action: "accept", Value: json.RawMessage(`{"colour":"Blue"}`),
	}}
	s := &session{host: host}
	got, err := s.handleRequest(context.Background(), "item/tool/requestUserInput", json.RawMessage(`{
		"turnId":"turn-1","threadId":"thread-1","itemId":"item-1","isBlocking":true,
		"questions":[{"id":"colour","header":"Colour","question":"Pick one","options":[{"label":"Blue","description":"Cool"}]}]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if host.request.TurnID != "turn-1" || len(host.request.Schema) == 0 {
		t.Fatalf("elicitation request was not canonicalised: %+v", host.request)
	}
	blob, _ := json.Marshal(got)
	if string(blob) != `{"answers":{"colour":{"answers":["Blue"]}}}` {
		t.Fatalf("response=%s", blob)
	}
}

func TestMCPElicitationIsRoutedThroughHost(t *testing.T) {
	host := &elicitHost{result: adapter.ElicitationResult{
		Action: "accept", Value: json.RawMessage(`{"name":"Ada"}`),
	}}
	s := &session{host: host}
	got, err := s.handleRequest(context.Background(), "mcpServer/elicitation/request", json.RawMessage(`{
		"threadId":"thread-1","turnId":"turn-1","serverName":"demo","mode":"form",
		"message":"Your name?","requestedSchema":{"type":"object","properties":{"name":{"type":"string"}}}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	blob, _ := json.Marshal(got)
	if string(blob) != `{"action":"accept","content":{"name":"Ada"}}` {
		t.Fatalf("response=%s", blob)
	}
}
