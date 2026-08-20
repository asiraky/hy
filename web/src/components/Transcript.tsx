import {
  ArrowRightIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  DownloadIcon,
  FileTextIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import type { Item, SessionState, ToolStatus, Turn } from "~/protocol";
import { useSmoothText } from "~/useSmoothText";

// One icon per tool kind the protocol defines. Anything new falls through to
// the neutral dot rather than rendering nothing.
const TOOL_ICON: Record<string, ComponentType<{ className?: string }>> = {
  read: FileTextIcon,
  edit: PencilIcon,
  delete: Trash2Icon,
  move: ArrowRightIcon,
  search: SearchIcon,
  execute: TerminalIcon,
  think: BrainIcon,
  fetch: DownloadIcon,
  other: CircleIcon,
};

function StatusMark({ status }: { status?: ToolStatus }) {
  if (status === "in_progress" || status === "pending")
    return <Spinner className="text-primary size-3.5" />;
  if (status === "failed")
    return <XIcon aria-label="Failed" className="text-destructive size-3.5" />;
  return <CheckIcon aria-label="Done" className="text-success size-3.5" />;
}

function ToolCard({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const output = (item.content ?? [])
    .map((c) => (c.type === "diff" ? `--- ${c.path}\n${c.text ?? ""}` : (c.text ?? "")))
    .join("\n")
    .trim();
  const Icon = TOOL_ICON[item.toolKind ?? "other"] ?? CircleIcon;

  return (
    <div className="fade-in bg-card/60 rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="hover:bg-accent/40 focus-visible:ring-ring flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2 md:min-h-0"
      >
        <Icon className="text-muted-foreground size-3.5 shrink-0" />
        <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[13px]">
          {item.title || "tool"}
        </span>
        <StatusMark status={item.status} />
        {output && (
          <span className="text-muted-foreground flex shrink-0 items-center gap-1 font-mono text-[10px]">
            {open ? "hide" : `${output.split("\n").length} lines`}
            <ChevronDownIcon className={cn("size-3 transition-transform", open && "rotate-180")} />
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t px-3 py-2">
          {item.input != null && (
            <pre className="scroll-thin bg-muted/60 text-muted-foreground max-h-40 overflow-auto overscroll-contain rounded-md p-2 font-mono text-[11px] leading-relaxed">
              {JSON.stringify(item.input, null, 2)}
            </pre>
          )}
          {output && (
            <pre className="scroll-thin bg-muted/60 max-h-80 overflow-auto overscroll-contain rounded-md p-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
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
        <div className="text-muted-foreground rounded-full border px-3 py-1 text-[12px]">
          Server restarted — the agent was asked to pick the work back up
        </div>
      </div>
    );
  }

  if (item.role === "user") {
    return (
      <div className="fade-in flex justify-end">
        <div className="bg-user-bubble text-user-bubble-foreground max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-[14px] leading-relaxed break-words whitespace-pre-wrap">
          {item.text}
        </div>
      </div>
    );
  }

  if (item.contentKind === "thought") {
    return (
      <div className="fade-in text-thought border-l-2 pl-3 text-[13px] leading-relaxed break-words whitespace-pre-wrap italic">
        {text}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "fade-in text-[14px] leading-relaxed break-words whitespace-pre-wrap",
        streaming && "caret",
      )}
    >
      {text}
    </div>
  );
}

function WorkspaceCard({
  state,
  onRetry,
  onCleanup,
  onForceDelete,
}: {
  state: SessionState;
  onRetry: () => void;
  onCleanup: () => void;
  onForceDelete: () => void;
}) {
  const ws = state.workspace;
  const active =
    state.phase === "provisioning" || state.phase === "creating" || state.phase === "cleaning";
  const failed = state.phase === "provision_failed" || state.phase === "cleanup_failed";
  const [open, setOpen] = useState(active || failed);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (active || failed) {
      setOpen(true);
      setDismissed(false);
    } else if (ws.phase === "ready") setOpen(false);
  }, [active, failed, ws.phase]);

  if (!ws.phase || dismissed) return null;

  const title =
    state.phase === "cleaning"
      ? "Cleaning up workspace"
      : failed
        ? "Workspace needs attention"
        : ws.phase === "ready"
          ? "Workspace ready"
          : ws.phase === "released"
            ? "Workspace released"
            : "Preparing workspace";
  const elapsed = ws.durationMs ? `${Math.max(1, Math.round(ws.durationMs / 1000))}s` : "";

  return (
    <div
      className={cn(
        "fade-in bg-card/70 rounded-xl border",
        failed && "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {active ? (
          <Spinner className="text-primary size-4" />
        ) : failed ? (
          <TriangleAlertIcon aria-hidden className="text-destructive size-4 shrink-0" />
        ) : (
          <CheckIcon aria-hidden className="text-success size-4 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="focus-visible:ring-ring min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2"
        >
          <span className="text-muted-foreground block text-[11px]">Workspace provisioner</span>
          <span className="block text-[13px]">
            {title}
            {elapsed && ` · ${elapsed}`}
          </span>
        </button>
        {ws.phase === "ready" && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss workspace activity"
            className="size-11 md:size-8"
            onClick={() => setDismissed(true)}
          >
            <XIcon />
          </Button>
        )}
      </div>

      {open && (
        <div className="border-t p-3">
          {ws.command && (
            <p className="text-muted-foreground mb-2 truncate font-mono text-[11px]">{ws.command}</p>
          )}
          <pre className="scroll-thin bg-muted/60 max-h-80 min-h-20 overflow-auto rounded-md p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {ws.output || (active ? "Starting…" : "No output")}
          </pre>
          {ws.error && (
            <p className="bg-destructive/10 text-destructive mt-2 rounded-md px-2 py-1.5 font-mono text-[11px]">
              {ws.error}
              {ws.exitCode ? ` (exit ${ws.exitCode})` : ""}
            </p>
          )}
          {failed && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={state.phase === "cleanup_failed" ? onCleanup : onRetry}
              >
                Retry
              </Button>
              {state.phase === "provision_failed" && (
                <Button size="sm" variant="outline" onClick={onCleanup}>
                  Clean up
                </Button>
              )}
              {state.phase === "cleanup_failed" && (
                <Button size="sm" variant="destructive" onClick={onForceDelete}>
                  Force delete…
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// InterruptedCard is what a turn that died looks like. A cross on the last
// tool call is not an explanation: it says something stopped, not that the
// work is unfinished and nobody is coming back for it. The server retries by
// itself after a restart, so this appears when that did not happen or did not
// work — which is precisely when a human has to decide.
function InterruptedCard({ turn, onContinue }: { turn: Turn; onContinue: () => void }) {
  const [sending, setSending] = useState(false);
  const restarted = (turn.error ?? "").includes("restarted");

  return (
    <div className="fade-in border-destructive/30 bg-destructive/5 rounded-lg border px-3.5 py-3">
      <p className="text-[13px]">
        {restarted
          ? "The server restarted and this turn was interrupted before it finished."
          : "This turn ended with an error before it finished."}
      </p>
      {turn.error && !restarted && (
        <p className="text-destructive mt-1.5 font-mono text-[11px] break-words">{turn.error}</p>
      )}
      <p className="text-muted-foreground mt-1.5 text-[12px]">
        {turn.recovery
          ? "Picking it back up automatically did not work."
          : "The work was left unfinished."}
      </p>
      <Button
        size="sm"
        className="mt-2.5"
        disabled={sending}
        onClick={() => {
          setSending(true);
          onContinue();
        }}
      >
        {sending ? "Continuing…" : "Continue where it left off"}
      </Button>
    </div>
  );
}

export function Transcript({
  state,
  onRetryProvision,
  onCleanup,
  onForceDelete,
  onContinue,
}: {
  state: SessionState;
  onRetryProvision: () => void;
  onCleanup: () => void;
  onForceDelete: () => void;
  onContinue: () => void;
}) {
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

  // Only the newest turn can be continued, and only once nothing is running:
  // an error further back was already answered by whatever came after it.
  const interrupted = useMemo(() => {
    if (state.closed || state.phase === "turn") return undefined;
    const last = state.turns[state.turns.length - 1];
    return last?.done && last.stopReason === "error" ? last : undefined;
  }, [state.turns, state.phase, state.closed]);

  const recoveredTurns = useMemo(
    () => new Set(state.turns.filter((t) => t.recovery).map((t) => t.id)),
    [state.turns],
  );

  return (
    <div ref={ref} className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-3.5 px-4 py-6 md:px-5">
        <WorkspaceCard
          state={state}
          onRetry={onRetryProvision}
          onCleanup={onCleanup}
          onForceDelete={onForceDelete}
        />
        {state.items.length === 0 && !state.workspace.phase && (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-20 text-center">
            <TerminalIcon className="size-5 opacity-60" />
            <p className="text-sm">Nothing yet.</p>
            <p className="text-[13px]">Send a prompt to start the turn.</p>
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
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner className="text-primary size-3.5" /> thinking…
          </div>
        )}

        {interrupted && <InterruptedCard turn={interrupted} onContinue={onContinue} />}
      </div>
    </div>
  );
}
