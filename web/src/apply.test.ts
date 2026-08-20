import { describe, expect, it } from "vitest";

import { applyEvent, emptyState } from "./apply";
import type { Event } from "./protocol";

function ev(seq: number, type: string, payload: Record<string, unknown>): Event {
  return { sessionId: "s1", seq, timestamp: 0, type, payload } as Event;
}

// These mirror internal/projection/state_test.go: the client reducer and the
// server projection must reach the same phase from the same events.
describe("applyEvent turn lifecycle", () => {
  it("opens a harness-initiated turn without fabricating a prompt item", () => {
    let s = emptyState("s1");
    s = applyEvent(s, ev(1, "turn.started", { turnId: "t1" }));
    expect(s.phase).toBe("turn");
    expect(s.turns).toHaveLength(1);
    expect(s.items).toHaveLength(0);

    s = applyEvent(s, ev(2, "turn.finished", { turnId: "t1", stopReason: "end_turn" }));
    expect(s.phase).toBe("idle");
    expect(s.turns[0].done).toBe(true);
  });

  it("keeps the prompt item on a prompted turn", () => {
    let s = emptyState("s1");
    s = applyEvent(s, ev(1, "turn.started", { turnId: "t1", prompt: "do the thing" }));
    expect(s.items).toHaveLength(1);
    expect(s.items[0].text).toBe("do the thing");
  });

  it("treats streaming while idle as a running turn", () => {
    let s = emptyState("s1");
    s = applyEvent(s, ev(1, "message.chunk", { blockId: "b1", role: "agent", kind: "text", delta: "The web" }));
    expect(s.phase).toBe("turn");

    let s2 = emptyState("s2");
    s2 = applyEvent(s2, ev(1, "tool_call.started", { toolCallId: "c1", kind: "execute", title: "ls", status: "pending" }));
    expect(s2.phase).toBe("turn");
  });

  it("does not reopen a closed session on a stray chunk", () => {
    let s = emptyState("s1");
    s = applyEvent(s, ev(1, "session.closed", { reason: "closed" }));
    s = applyEvent(s, ev(2, "message.chunk", { blockId: "b1", role: "agent", kind: "text", delta: "late" }));
    expect(s.phase).toBe("closed");
  });
});
