package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/asiraky/hy/internal/adapter"
	"github.com/asiraky/hy/internal/proto"
	"github.com/asiraky/hy/internal/session"
	"github.com/asiraky/hy/internal/store"
)

// conn is one presenter connection. It holds no session state of its own —
// everything a UI needs is reconstructible from the log.
type conn struct {
	srv *Server
	ws  *websocket.Conn
	id  string
	ctx context.Context

	// deviceID is the device that authorised the upgrade, so the connection
	// can be cut when that device is revoked.
	deviceID string

	wmu sync.Mutex

	amu      sync.Mutex
	attached map[string]context.CancelFunc
}

func (s *Server) handleWS(ws *websocket.Conn, ctx context.Context, deviceID string) {
	c := &conn{
		srv:      s,
		ws:       ws,
		id:       uuid.NewString(),
		ctx:      ctx,
		deviceID: deviceID,
		attached: map[string]context.CancelFunc{},
	}
	defer c.detachAll()

	// Authorisation is checked once, at upgrade. A socket therefore outlives
	// the credential that opened it unless something closes it, which is what
	// this registration is for: revoking a stolen device has to cut the
	// connection it already holds, not merely refuse the next one.
	s.register(c)
	defer s.unregister(c)

	// Session-list changes push a fresh welcome-shaped frame.
	listID, listCh := s.mgr.SubscribeList()
	defer s.mgr.UnsubscribeList(listID)

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-listCh:
				c.sendSessions()
			}
		}
	}()

	for {
		typ, data, err := ws.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageText {
			continue
		}
		var f clientFrame
		if err := json.Unmarshal(data, &f); err != nil {
			c.send(serverFrame{Type: "error", Error: "malformed frame"})
			continue
		}
		c.dispatch(f)
	}
}

func (c *conn) dispatch(f clientFrame) {
	switch f.Type {
	case "hello":
		sessions, _ := c.srv.mgr.List(c.ctx)
		projects, _ := c.srv.mgr.Projects(c.ctx)
		c.send(serverFrame{
			Type:      "welcome",
			ServerID:  c.srv.id,
			Build:     c.srv.web.BuildID(),
			Sessions:  sessions,
			Harnesses: c.srv.mgr.Harnesses(c.ctx),
			Projects:  projects,
			Cwd:       c.srv.defaultCwd,
			Access:    c.srv.access(c.ctx),
		})

	case "attach":
		c.attach(f)

	case "detach":
		c.detach(f.SessionID)

	case "command":
		// Off the read loop: creating a session spawns a harness process and
		// a prompt can wait on the actor, neither of which may stall the
		// connection's other frames. Acks carry their commandId, so order
		// does not matter.
		go c.command(f)

	case "ping":
		c.send(serverFrame{Type: "pong"})
	}
}

func (c *conn) sendSessions() {
	sessions, err := c.srv.mgr.List(c.ctx)
	if err != nil {
		return
	}
	c.send(serverFrame{Type: "sessions", Sessions: sessions})
}

// attach implements the ordering the spec calls load-bearing: subscribe first,
// then read history, then mark synchronized, then drain what buffered.
func (c *conn) attach(f clientFrame) {
	if f.SessionID == "" {
		c.send(serverFrame{Type: "error", Error: "attach requires sessionId"})
		return
	}
	c.detach(f.SessionID) // re-attach is idempotent

	actor, err := c.srv.mgr.Get(c.ctx, f.SessionID)
	if err != nil {
		c.send(serverFrame{Type: "error", SessionID: f.SessionID, Error: err.Error()})
		return
	}

	// 1. Subscribe first, so nothing can land in the gap between the read
	//    below and the start of live delivery.
	sub := actor.Subscribe()

	after := int64(0)
	hasCursor := f.AfterSeq != nil
	if hasCursor {
		after = *f.AfterSeq
	}

	res, err := actor.Attach(c.ctx, after, hasCursor)
	if err != nil {
		actor.Unsubscribe(sub)
		c.send(serverFrame{Type: "error", SessionID: f.SessionID, Error: err.Error()})
		return
	}

	switch res.Kind {
	case session.AttachSnapshot:
		c.send(serverFrame{Type: "snapshot", SessionID: f.SessionID, Seq: res.Seq, State: res.Snapshot})
	default:
		for i := range res.Events {
			ev := res.Events[i]
			c.send(serverFrame{Type: "event", SessionID: f.SessionID, Seq: ev.Seq, Event: &ev})
		}
	}
	c.send(serverFrame{Type: "synchronized", SessionID: f.SessionID, Seq: res.Seq})

	ctx, cancel := context.WithCancel(c.ctx)
	c.amu.Lock()
	c.attached[f.SessionID] = func() {
		cancel()
		actor.Unsubscribe(sub)
	}
	c.amu.Unlock()

	// 2. Drain the live queue. Events at or below the catch-up point are
	//    dropped here; the client also discards seq <= lastApplied.
	go func() {
		defer actor.Unsubscribe(sub)
		for {
			select {
			case <-ctx.Done():
				return
			case <-sub.Resync:
				c.send(serverFrame{Type: "resync", SessionID: f.SessionID})
				return
			case ev, ok := <-sub.Ch:
				if !ok {
					return
				}
				if ev.Seq <= res.Seq {
					continue
				}
				c.send(serverFrame{Type: "event", SessionID: f.SessionID, Seq: ev.Seq, Event: &ev})
			}
		}
	}()
}

func (c *conn) detach(sessionID string) {
	c.amu.Lock()
	cancel, ok := c.attached[sessionID]
	delete(c.attached, sessionID)
	c.amu.Unlock()
	if ok {
		cancel()
	}
}

func (c *conn) detachAll() {
	c.amu.Lock()
	all := c.attached
	c.attached = map[string]context.CancelFunc{}
	c.amu.Unlock()
	for _, cancel := range all {
		cancel()
	}
}

// command executes an idempotent command. A repeated commandId replays the
// stored result rather than re-executing, so a retry after a dropped
// connection cannot double-send a prompt.
func (c *conn) command(f clientFrame) {
	if f.CommandID == "" {
		f.CommandID = uuid.NewString()
	}

	// A command belongs to the user operation, not to the socket that happened
	// to carry it. Let it finish and persist its result after a disconnect so a
	// reconnect can recover the acknowledgement with the same command id.
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	for {
		stored, done, err := c.srv.store.ClaimCommand(ctx, f.CommandID, f.SessionID)
		switch {
		case errors.Is(err, store.ErrCommandInProgress):
			select {
			case <-time.After(25 * time.Millisecond):
				continue
			case <-ctx.Done():
				c.ack(f.CommandID, nil, ctx.Err())
				return
			}
		case err != nil:
			c.ack(f.CommandID, nil, err)
			return
		case done:
			c.send(serverFrame{Type: "ack", CommandID: f.CommandID, Result: stored})
			return
		default:
			goto claimed
		}
	}

claimed:
	result, err := c.execute(ctx, f)
	if err != nil {
		// A failed command is not done; release the claim so retrying this exact
		// user operation can try again.
		_ = c.srv.store.ReleaseCommand(context.Background(), f.CommandID)
		c.ack(f.CommandID, nil, err)
		return
	}
	if err := c.srv.store.CompleteCommand(context.Background(), f.CommandID, result); err != nil {
		c.ack(f.CommandID, nil, fmt.Errorf("command ran but its result could not be persisted: %w", err))
		return
	}
	c.ack(f.CommandID, result, nil)
}

func (c *conn) execute(ctx context.Context, f clientFrame) (any, error) {
	switch f.Command {
	case "create_session":
		var a createArgs
		if err := json.Unmarshal(f.Args, &a); err != nil {
			return nil, err
		}
		if a.ProjectID != "" {
			actor, err := c.srv.mgr.CreateProject(ctx, session.CreateProjectOptions{ProjectID: a.ProjectID, Harness: a.Harness, Model: a.Model, Mode: a.Mode, Branch: a.Branch, Workspace: a.Workspace})
			if err != nil {
				return nil, err
			}
			return map[string]any{"sessionId": actor.ID}, nil
		}
		if a.Cwd == "" {
			a.Cwd = c.srv.defaultCwd
		}
		actor, err := c.srv.mgr.Create(ctx, a.Harness, a.Cwd, a.Model, a.Mode)
		if err != nil {
			return nil, err
		}
		return map[string]any{"sessionId": actor.ID}, nil

	case "prompt":
		var a promptArgs
		if err := json.Unmarshal(f.Args, &a); err != nil {
			return nil, err
		}
		actor, err := c.srv.mgr.Get(ctx, a.SessionID)
		if err != nil {
			return nil, err
		}
		turnID, err := actor.Prompt(ctx, a.Text)
		if err != nil {
			return nil, err
		}
		c.srv.mgr.NotifyList()
		return map[string]any{"turnId": turnID}, nil

	case "cancel":
		var a sessionArgs
		if err := json.Unmarshal(f.Args, &a); err != nil {
			return nil, err
		}
		actor, ok := c.srv.mgr.Peek(a.SessionID)
		if !ok {
			return map[string]any{"status": "idle"}, nil
		}
		if err := actor.Cancel(ctx); err != nil {
			return nil, err
		}
		return map[string]any{"status": "cancelling"}, nil

	case "resolve_permission":
		var a resolveArgs
		if err := json.Unmarshal(f.Args, &a); err != nil {
			return nil, err
		}
		actor, ok := c.srv.mgr.Peek(a.SessionID)
		if !ok {
			return nil, errors.New("session is not live")
		}
		err := actor.ResolvePermission(ctx, a.RequestID, adapter.PermissionOutcome{
			Outcome: normaliseOutcome(a.Outcome), OptionID: a.OptionID,
		})
		if errors.Is(err, session.ErrAlreadyResolved) {
			return map[string]any{"status": "already_resolved"}, nil
		}
		if err != nil {
			return nil, err
		}
		return map[string]any{"status": "resolved"}, nil

	case "resolve_elicitation":
		var a resolveElicitationArgs
		if err := json.Unmarshal(f.Args, &a); err != nil {
			return nil, err
		}
		actor, ok := c.srv.mgr.Peek(a.SessionID)
		if !ok {
			return nil, errors.New("session is not live")
		}
		action := a.Action
		if action != "accept" && action != "decline" && action != "cancel" {
			action = "cancel"
		}
		err := actor.ResolveElicitation(ctx, a.RequestID, adapter.ElicitationResult{Action: action, Value: a.Value})
		if errors.Is(err, session.ErrAlreadyResolved) {
			return map[string]any{"status": "already_resolved"}, nil
		}
		if err != nil {
			return nil, err
		}
		return map[string]any{"status": "resolved"}, nil

	case "enable_https":
		return c.srv.setHTTPS(ctx, true)

	case "disable_https":
		return c.srv.setHTTPS(ctx, false)

	case "recheck_harnesses":
		c.srv.mgr.RecheckHarnesses()
		return map[string]any{"harnesses": c.srv.mgr.Harnesses(ctx)}, nil

	case "add_project":
		var a addProjectArgs
		if err := json.Unmarshal(f.Args, &a); err != nil {
			return nil, err
		}
		p, err := c.srv.mgr.AddProject(ctx, a.Root)
		if err != nil {
			return nil, err
		}
		return map[string]any{"project": p}, nil

	case "save_project":
		var a saveProjectArgs
		if err := json.Unmarshal(f.Args, &a); err != nil {
			return nil, err
		}
		p, err := c.srv.mgr.SaveProject(ctx, a.ProjectID, a.Config)
		if err != nil {
			return nil, err
		}
		return map[string]any{"project": p}, nil

	case "retry_provision":
		var a sessionArgs
		if err := json.Unmarshal(f.Args, &a); err != nil {
			return nil, err
		}
		return map[string]any{"status": "provisioning"}, c.srv.mgr.RetryProvision(ctx, a.SessionID)

	case "cleanup_session":
		var a sessionArgs
		if err := json.Unmarshal(f.Args, &a); err != nil {
			return nil, err
		}
		return map[string]any{"status": "cleaning"}, c.srv.mgr.Cleanup(ctx, a.SessionID)

	case "close_session":
		var a sessionArgs
		if err := json.Unmarshal(f.Args, &a); err != nil {
			return nil, err
		}
		return map[string]any{"status": "cleaning"}, c.srv.mgr.Cleanup(ctx, a.SessionID)

	case "delete_session":
		var a sessionArgs
		if err := json.Unmarshal(f.Args, &a); err != nil {
			return nil, err
		}
		return map[string]any{"status": "deleting"}, c.srv.mgr.Delete(ctx, a.SessionID)

	case "force_delete_session":
		var a sessionArgs
		if err := json.Unmarshal(f.Args, &a); err != nil {
			return nil, err
		}
		return map[string]any{"status": "deleted"}, c.srv.mgr.ForceDelete(ctx, a.SessionID)

	default:
		return nil, fmt.Errorf("unknown command %q", f.Command)
	}
}

func normaliseOutcome(o string) string {
	switch o {
	case proto.OutcomeAllowOnce, proto.OutcomeAllowAlways,
		proto.OutcomeRejectOnce, proto.OutcomeRejectAlways, proto.OutcomeCancelled:
		return o
	case "allow":
		return proto.OutcomeAllowOnce
	case "always":
		return proto.OutcomeAllowAlways
	default:
		return proto.OutcomeRejectOnce
	}
}

func (c *conn) ack(commandID string, result any, err error) {
	f := serverFrame{Type: "ack", CommandID: commandID}
	if err != nil {
		f.Error = err.Error()
	} else if result != nil {
		raw, _ := json.Marshal(result)
		f.Result = raw
	}
	c.send(f)
}

func (c *conn) send(f serverFrame) {
	b, err := json.Marshal(f)
	if err != nil {
		return
	}
	c.wmu.Lock()
	defer c.wmu.Unlock()
	ctx, cancel := context.WithTimeout(c.ctx, 10*time.Second)
	defer cancel()
	_ = c.ws.Write(ctx, websocket.MessageText, b)
}
