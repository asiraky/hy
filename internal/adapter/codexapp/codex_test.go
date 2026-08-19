package codexapp

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/asiraky/hy/internal/adapter"
)

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
