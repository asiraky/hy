// Package server exposes the sync protocol over WebSocket plus a small HTTP
// API. Presenters never see JSON-RPC or a harness; they see this.
package server

import (
	"encoding/json"

	"github.com/asiraky/hy/internal/endpoints"
	"github.com/asiraky/hy/internal/projection"
	"github.com/asiraky/hy/internal/proto"
	"github.com/asiraky/hy/internal/session"
	"github.com/asiraky/hy/internal/store"
)

// ProtocolVersion is bumped when the wire format changes incompatibly.
const ProtocolVersion = 1

// Client → server frames.
type clientFrame struct {
	Type string `json:"type"`

	// hello
	ProtocolVersion int    `json:"protocolVersion,omitempty"`
	ClientID        string `json:"clientId,omitempty"`

	// attach / detach
	SessionID string `json:"sessionId,omitempty"`
	AfterSeq  *int64 `json:"afterSeq,omitempty"`

	// command
	CommandID string          `json:"commandId,omitempty"`
	Command   string          `json:"command,omitempty"`
	Args      json.RawMessage `json:"args,omitempty"`
}

// Server → client frames.
type serverFrame struct {
	Type string `json:"type"`

	ServerID string `json:"serverId,omitempty"`
	// Build identifies the UI bundle this server holds. A client running a
	// different one is stale and reloads itself.
	Build     string              `json:"build,omitempty"`
	Sessions  []store.SessionMeta `json:"sessions,omitempty"`
	Harnesses []session.Harness   `json:"harnesses,omitempty"`
	Cwd       string              `json:"cwd,omitempty"`
	// Access travels on welcome, after the gate, so an unpaired caller
	// learns nothing about how else this machine can be reached.
	Access *endpoints.Set `json:"access,omitempty"`

	SessionID string            `json:"sessionId,omitempty"`
	Seq       int64             `json:"seq,omitempty"`
	State     *projection.State `json:"state,omitempty"`
	Event     *proto.Event      `json:"event,omitempty"`

	CommandID string          `json:"commandId,omitempty"`
	Result    json.RawMessage `json:"result,omitempty"`
	Error     string          `json:"error,omitempty"`
}

// Command argument shapes.
type createArgs struct {
	Harness string `json:"harness"`
	Cwd     string `json:"cwd"`
	Model   string `json:"model"`
	Mode    string `json:"mode"`
}

type promptArgs struct {
	SessionID string `json:"sessionId"`
	Text      string `json:"text"`
}

type sessionArgs struct {
	SessionID string `json:"sessionId"`
}

type resolveArgs struct {
	SessionID string `json:"sessionId"`
	RequestID string `json:"requestId"`
	Outcome   string `json:"outcome"`
	OptionID  string `json:"optionId"`
}

type resolveElicitationArgs struct {
	SessionID string          `json:"sessionId"`
	RequestID string          `json:"requestId"`
	Action    string          `json:"action"`
	Value     json.RawMessage `json:"value"`
}
