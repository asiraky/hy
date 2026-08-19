// Folding events into SessionState. This mirrors internal/projection exactly:
// the server sends a snapshot or a replay, then live events, and applying them
// here must reach the same state the server holds.

import type { Event, Item, SessionState } from "./protocol";

export function emptyState(sessionId: string): SessionState {
  return {
    sessionId,
    seq: 0,
    cwd: "",
    harness: "",
    model: "",
    mode: "",
    effort: "",
    title: "",
    phase: "idle",
    closed: false,
    workspace: { phase: "" },
    items: [],
    turns: [],
    plan: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    pendingPermissions: [],
    pendingElicitations: [],
  };
}

function upsert(state: SessionState, id: string, mut: (it: Item) => void): Item[] {
  const i = state.items.findIndex((it) => it.id === id);
  if (i >= 0) {
    const next = { ...state.items[i] };
    mut(next);
    const items = state.items.slice();
    items[i] = next;
    return items;
  }
  const it: Item = { id, kind: "message" };
  mut(it);
  return [...state.items, it];
}

// applyEvent returns a new state. Events at or below the applied cursor are
// discarded, which is what makes at-least-once delivery safe.
export function applyEvent(state: SessionState, ev: Event): SessionState {
  if (ev.seq <= state.seq) return state;
  const s: SessionState = { ...state, seq: ev.seq };
  const p = ev.payload ?? {};

  switch (ev.type) {
    case "session.created":
      return { ...s, cwd: p.cwd, harness: p.harness, model: p.model ?? "", mode: p.mode ?? "", effort: p.effort ?? "", title: p.title ?? "" };

    case "session.config_changed":
      return {
        ...s,
        model: p.model || s.model,
        mode: p.mode || s.mode,
        title: p.title || s.title,
      };

    case "session.closed":
      return { ...s, closed: true, phase: "closed" };

    case "workspace.requested":
      return { ...s, phase: "provisioning", workspace: { phase: "provisioning", projectId: p.projectId, projectRoot: p.projectRoot, mode: p.mode, branch: p.branch, baseRef: p.baseRef, startedAt: ev.timestamp } };
    case "workspace.hook_started":
      return { ...s, phase: p.hook === "deprovision" ? "cleaning" : s.phase, workspace: { ...s.workspace, phase: p.hook === "deprovision" ? "cleaning" : s.workspace.phase, hook: p.hook, command: p.command } };
    case "workspace.hook_output":
      return { ...s, workspace: { ...s.workspace, output: (s.workspace.output ?? "") + (p.stream === "stderr" ? "[stderr] " : "") + (p.chunk ?? "") } };
    case "workspace.hook_finished":
      return { ...s, workspace: { ...s.workspace, exitCode: p.exitCode, durationMs: p.durationMs } };
    case "workspace.ready":
      return { ...s, cwd: p.cwd, phase: "idle", workspace: { ...s.workspace, phase: "ready", branch: p.branch, resources: p.resources, error: undefined } };
    case "workspace.failed":
      return { ...s, phase: "provision_failed", workspace: { ...s.workspace, phase: "provision_failed", error: p.error, exitCode: p.exitCode } };
    case "workspace.cleanup_started":
      return { ...s, phase: "cleaning", workspace: { ...s.workspace, phase: "cleaning", deleteAfterCleanup: !!p.purge } };
    case "workspace.cleanup_failed":
      return { ...s, phase: "cleanup_failed", workspace: { ...s.workspace, phase: "cleanup_failed", error: p.error, exitCode: p.exitCode } };
    case "workspace.cleanup_finished":
    case "workspace.released":
      return { ...s, workspace: { ...s.workspace, phase: "released" } };

    case "turn.started":
      return {
        ...s,
        phase: "turn",
        // A recovery prompt is the server talking to itself, so it never
        // names the session.
        title: s.title || (p.recovery ? "" : p.prompt?.slice(0, 60) || ""),
        turns: [...s.turns, { id: p.turnId, prompt: p.prompt, done: false, recovery: p.recovery }],
        items: upsert(s, `prompt:${p.turnId}`, (it) => {
          it.kind = "message";
          it.role = "user";
          it.contentKind = "text";
          it.text = p.prompt;
          it.turnId = p.turnId;
        }),
      };

    case "turn.finished":
      return {
        ...s,
        phase: "idle",
        turns: s.turns.map((t) =>
          t.id === p.turnId ? { ...t, done: true, stopReason: p.stopReason, error: p.error } : t,
        ),
        items: s.items.map((it) =>
          it.kind === "tool" && (it.status === "in_progress" || it.status === "pending")
            ? { ...it, status: "failed" as const }
            : it,
        ),
      };

    case "message.chunk":
      return {
        ...s,
        items: upsert(s, p.blockId, (it) => {
          it.kind = "message";
          it.role = p.role;
          it.contentKind = p.kind;
          it.turnId = p.turnId;
          it.text = (it.text ?? "") + p.delta;
        }),
      };

    case "tool_call.started":
      return {
        ...s,
        items: upsert(s, p.toolCallId, (it) => {
          it.kind = "tool";
          it.turnId = p.turnId;
          it.toolKind = p.kind;
          it.title = p.title;
          it.status = p.status;
          it.input = p.rawInput;
        }),
      };

    case "tool_call.updated":
      return {
        ...s,
        items: upsert(s, p.toolCallId, (it) => {
          it.kind = "tool";
          if (p.status) it.status = p.status;
          if (p.title) it.title = p.title;
          if (p.rawInput) it.input = p.rawInput;
          if (p.content?.length) it.content = [...(it.content ?? []), ...p.content];
        }),
      };

    case "plan.updated":
      return { ...s, plan: p.entries ?? [] };

    case "usage.updated":
      return { ...s, usage: p };

    case "permission.requested":
      return {
        ...s,
        pendingPermissions: [
          ...s.pendingPermissions,
          {
            requestId: p.requestId,
            toolCallId: p.toolCallId,
            toolName: p.toolName,
            title: p.title,
            input: p.rawInput,
            options: p.options ?? [],
          },
        ],
      };

    case "permission.resolved":
      return {
        ...s,
        pendingPermissions: s.pendingPermissions.filter((x) => x.requestId !== p.requestId),
      };

	case "elicitation.requested":
		return {
			...s,
			pendingElicitations: [
				...(s.pendingElicitations ?? []),
				{ requestId: p.requestId, prompt: p.prompt, schema: p.schema ?? {} },
			],
		};

	case "elicitation.resolved":
		return {
			...s,
			pendingElicitations: (s.pendingElicitations ?? []).filter((x) => x.requestId !== p.requestId),
		};

    default:
      return s;
  }
}
