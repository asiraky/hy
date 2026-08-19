import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Item, SessionState, ToolStatus } from "../protocol";
import { useSmoothText } from "../useSmoothText";
import { Spinner } from "./ui";
import { cx } from "../cx";

const toolGlyph: Record<string, string> = {
  read: "◇",
  edit: "✎",
  delete: "✕",
  move: "→",
  search: "⌕",
  execute: "❯",
  think: "◈",
  fetch: "⇣",
  other: "•",
};

function StatusMark({ status }: { status?: ToolStatus }) {
  if (status === "in_progress" || status === "pending")
    return <Spinner className="text-accent" />;
  if (status === "failed") return <span className="text-red-400">✕</span>;
  return <span className="text-emerald-400/80">✓</span>;
}

function ToolCard({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const output = (item.content ?? [])
    .map((c) => (c.type === "diff" ? `--- ${c.path}\n${c.text ?? ""}` : (c.text ?? "")))
    .join("\n")
    .trim();

  return (
    <div className="fade-in rounded-lg border border-ink-800 bg-ink-900/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left md:min-h-0"
      >
        <span className="w-4 shrink-0 text-center font-mono text-xs text-ink-500">
          {toolGlyph[item.toolKind ?? "other"] ?? "•"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink-300">
          {item.title || "tool"}
        </span>
        <StatusMark status={item.status} />
        {output && (
          <span className="shrink-0 font-mono text-[10px] text-ink-500">
            {open ? "hide" : `${output.split("\n").length} lines`}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-ink-800 px-3 py-2">
          {item.input != null && (
            <pre className="scroll-thin mb-2 max-h-40 overflow-auto overscroll-contain rounded bg-ink-950/70 p-2 font-mono text-[11px] leading-relaxed text-ink-500">
              {JSON.stringify(item.input, null, 2)}
            </pre>
          )}
          {output && (
            <pre className="scroll-thin max-h-80 overflow-auto overscroll-contain rounded bg-ink-950/70 p-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-ink-300">
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Message({ item, streaming, recovered }: { item: Item; streaming: boolean; recovered: boolean }) {
  // Paced reveal, so a harness that delivers a line at a time still reads as
  // continuous output. Inactive messages render whole.
  const text = useSmoothText(item.text ?? "", streaming);

  // The prompt that restarts interrupted work was written by the server, not
  // by the person reading this. Showing it as their own message would be a
  // lie; what they need to know is that a restart happened and the agent was
  // put back to work.
  if (recovered && item.role === "user") {
    return (
      <div className="fade-in flex justify-center">
        <div className="rounded-full border border-ink-800 px-3 py-1 text-[12px] text-ink-500">
          Server restarted — the agent was asked to pick the work back up
        </div>
      </div>
    );
  }

  if (item.role === "user") {
    return (
      <div className="fade-in flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-dim/25 px-3.5 py-2 text-[14px] leading-relaxed break-words whitespace-pre-wrap ring-1 ring-inset ring-accent/20">
          {item.text}
        </div>
      </div>
    );
  }

  if (item.contentKind === "thought") {
    return (
      <div className="fade-in border-l-2 border-ink-800 pl-3 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink-500 italic">
        {text}
      </div>
    );
  }

  return (
    <div
      className={cx(
        "fade-in text-[14px] leading-relaxed break-words whitespace-pre-wrap text-ink-100",
        streaming && "caret",
      )}
    >
      {text}
    </div>
  );
}

function WorkspaceCard({ state, onRetry, onCleanup, onForceDelete }: { state: SessionState; onRetry: () => void; onCleanup: () => void; onForceDelete: () => void }) {
  const ws = state.workspace;
  const active = state.phase === "provisioning" || state.phase === "creating" || state.phase === "cleaning";
  const failed = state.phase === "provision_failed" || state.phase === "cleanup_failed";
  const [open, setOpen] = useState(active || failed);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { if (active || failed) { setOpen(true); setDismissed(false); } else if (ws.phase === "ready") setOpen(false); }, [active, failed, ws.phase]);
  if (!ws.phase || dismissed) return null;
  const title = state.phase === "cleaning" ? "Cleaning up workspace" : failed ? "Workspace needs attention" : ws.phase === "ready" ? "Workspace ready" : ws.phase === "released" ? "Workspace released" : "Preparing workspace";
  const elapsed = ws.durationMs ? `${Math.max(1, Math.round(ws.durationMs / 1000))}s` : "";
  return <div className={cx("fade-in rounded-xl border bg-ink-900/70", failed ? "border-red-500/30" : "border-ink-800")}>
    <div className="flex items-center gap-2 px-3 py-2.5">
      {active ? <Spinner className="text-accent" /> : <span className={failed ? "text-red-400" : "text-emerald-400"}>{failed ? "✕" : "✓"}</span>}
      <button type="button" onClick={() => setOpen(v => !v)} className="min-w-0 flex-1 text-left">
        <span className="block text-[11px] text-ink-500">Workspace provisioner</span>
        <span className="block text-[13px] text-ink-100">{title}{elapsed && ` · ${elapsed}`}</span>
      </button>
      {ws.phase === "ready" && <button type="button" aria-label="Dismiss workspace activity" onClick={() => setDismissed(true)} className="px-2 text-ink-500 hover:text-ink-100">×</button>}
    </div>
    {open && <div className="border-t border-ink-800 p-3">
      {ws.command && <p className="mb-2 truncate font-mono text-[11px] text-ink-500">{ws.command}</p>}
      <pre className="scroll-thin max-h-80 min-h-20 overflow-auto rounded bg-ink-950/80 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-300">{ws.output || (active ? "Starting…" : "No output")}</pre>
      {ws.error && <p className="mt-2 rounded bg-red-500/10 px-2 py-1.5 font-mono text-[11px] text-red-300">{ws.error}{ws.exitCode ? ` (exit ${ws.exitCode})` : ""}</p>}
      {failed && <div className="mt-3 flex gap-2"><button type="button" onClick={state.phase === "cleanup_failed" ? onCleanup : onRetry} className="rounded bg-accent px-3 py-1.5 text-[12px] text-white">Retry</button>{state.phase === "provision_failed" && <button type="button" onClick={onCleanup} className="rounded border border-ink-700 px-3 py-1.5 text-[12px]">Clean up</button>}{state.phase === "cleanup_failed" && <button type="button" onClick={onForceDelete} className="rounded border border-red-500/40 px-3 py-1.5 text-[12px] text-red-300">Force delete…</button>}</div>}
    </div>}
  </div>;
}

export function Transcript({ state, onRetryProvision, onCleanup, onForceDelete }: { state: SessionState; onRetryProvision: () => void; onCleanup: () => void; onForceDelete: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow the tail unless the reader has scrolled up.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    if (pinned.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [state.items, state.seq]);

  // Text is revealed between event ticks, so following the tail has to watch
  // the content's size rather than React state.
  useEffect(() => {
    const scroller = ref.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const ro = new ResizeObserver(() => {
      if (pinned.current) scroller.scrollTop = scroller.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  // Only the final agent block is still growing; everything above it is
  // settled and renders in full.
  const lastAgentIndex = (() => {
    for (let i = state.items.length - 1; i >= 0; i--) {
      const it = state.items[i];
      if (it.kind === "message" && it.role === "agent") return i;
    }
    return -1;
  })();

  const recoveredTurns = useMemo(
    () => new Set(state.turns.filter((t) => t.recovery).map((t) => t.id)),
    [state.turns],
  );

  return (
    <div ref={ref} className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-3.5 px-4 py-6 md:px-5">
        <WorkspaceCard state={state} onRetry={onRetryProvision} onCleanup={onCleanup} onForceDelete={onForceDelete} />
        {state.items.length === 0 && !state.workspace.phase && (
          <div className="py-20 text-center text-sm text-ink-500">
            Nothing yet. Send a prompt to start the turn.
          </div>
        )}

        {state.items.map((item, i) =>
          item.kind === "tool" ? (
            <ToolCard key={item.id} item={item} />
          ) : (
            <Message
              key={item.id}
              item={item}
              streaming={state.phase === "turn" && i === lastAgentIndex}
              recovered={!!item.turnId && recoveredTurns.has(item.turnId)}
            />
          ),
        )}

        {state.phase === "turn" && lastAgentIndex === -1 && (
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <Spinner className="text-accent" /> thinking…
          </div>
        )}
      </div>
    </div>
  );
}
