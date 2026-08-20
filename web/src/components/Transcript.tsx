import {
  ArrowRightIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";

import { ChangedFiles } from "~/components/ChangedFiles";
import { Markdown } from "~/components/Markdown";
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

// A tool call is loud but rarely interesting. Runs of settled calls fold into
// one summary row so the conversation is what you read; anything that still
// needs a human — a failure, or a call still running — is left out of the fold
// and rendered on its own.
function isProminent(item: Item) {
  return item.status === "failed" || item.status === "pending" || item.status === "in_progress";
}

function isFoldableTool(item: Item) {
  return item.kind === "tool" && !isProminent(item);
}

// A harness narrates between its calls, and a run of fifty polls comes back as
// fifty calls with "Waiting." between each pair. Folding only consecutive tool
// items means one such word breaks every run, so a poll loop folds into
// nothing. Brief narration therefore rides along inside the fold — but only
// brief narration: a real explanation still breaks the run and stays where the
// reader can see it without opening anything.
const NARRATION_MAX = 200;

function isNarration(item: Item) {
  if (item.kind !== "message" || item.role !== "agent") return false;
  const text = (item.text ?? "").trim();
  return text.length > 0 && text.length <= NARRATION_MAX && !text.includes("\n");
}

// A harness can open a message block it never fills — a thought whose text the
// model kept to itself. There is nothing to render and nothing to hide, so it
// is dropped rather than left to print a blank line and cut a run in half.
function isEmptyMessage(item: Item) {
  return item.kind === "message" && (item.text ?? "").trim() === "";
}

type Row = { kind: "item"; item: Item } | { kind: "group"; id: string; items: Item[] };

function groupRows(items: Item[]): Row[] {
  const rows: Row[] = [];
  // The run being built, the narration trailing it that no later call has
  // claimed yet, and how many of the run's items are actually tool calls.
  let run: Item[] = [];
  let trailing: Item[] = [];
  let calls = 0;

  // A run ends at its last tool call: narration after that is the agent
  // talking to the reader, not labelling work, so it never gets folded away.
  // One call is not a run — it reads better as the card itself.
  const flush = () => {
    if (calls > 1) rows.push({ kind: "group", id: run[0].id, items: run });
    else for (const it of run) rows.push({ kind: "item", item: it });
    for (const it of trailing) rows.push({ kind: "item", item: it });
    run = [];
    trailing = [];
    calls = 0;
  };

  for (const item of items) {
    if (isEmptyMessage(item)) continue;
    if (isFoldableTool(item)) {
      run.push(...trailing, item);
      trailing = [];
      calls++;
      continue;
    }
    if (calls > 0 && isNarration(item)) {
      trailing.push(item);
      continue;
    }
    flush();
    rows.push({ kind: "item", item });
  }
  flush();
  return rows;
}

// A row belongs to the turn its last item came from: that is the turn whose
// card, if it has one, comes next.
function rowTurnID(row: Row): string | undefined {
  if (row.kind === "item") return row.item.turnId;
  return row.items[row.items.length - 1]?.turnId;
}

// One phrase per tool kind, in the order they read best in a summary. These
// count calls, not files: one call can touch several paths and five calls can
// touch one, so "Edited 3 files" would be a claim this cannot make. The Changes
// panel is where the honest per-file count lives.
const SUMMARY: { kind: string; one: string; many: (n: number) => string }[] = [
  { kind: "read", one: "1 read", many: (n) => `${n} reads` },
  { kind: "edit", one: "1 edit", many: (n) => `${n} edits` },
  { kind: "delete", one: "1 delete", many: (n) => `${n} deletes` },
  { kind: "move", one: "1 move", many: (n) => `${n} moves` },
  { kind: "search", one: "1 search", many: (n) => `${n} searches` },
  { kind: "execute", one: "1 command", many: (n) => `${n} commands` },
  { kind: "fetch", one: "1 fetch", many: (n) => `${n} fetches` },
  { kind: "think", one: "1 thought", many: (n) => `${n} thoughts` },
  { kind: "other", one: "1 other call", many: (n) => `${n} other calls` },
];

function summarise(items: Item[]): string {
  const counts = new Map<string, number>();
  for (const it of items) {
    if (it.kind !== "tool") continue;
    const kind = it.toolKind && SUMMARY.some((s) => s.kind === it.toolKind) ? it.toolKind : "other";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return SUMMARY.filter((s) => counts.has(s.kind))
    .map((s) => {
      const n = counts.get(s.kind)!;
      return n === 1 ? s.one : s.many(n);
    })
    .join(" · ");
}

function ToolGroup({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false);
  // A group can carry the narration that ran between its calls; the count and
  // the icons describe the work, so both only look at the calls.
  const calls = items.filter((i) => i.kind === "tool");
  const kinds = Array.from(new Set(calls.map((i) => i.toolKind ?? "other")));

  if (calls.length === 1) return <ToolCard item={calls[0]} />;

  return (
    <div className="fade-in">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="hover:bg-accent/40 focus-visible:ring-ring text-muted-foreground flex min-h-11 w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2 md:min-h-0"
      >
        <span className="flex shrink-0 items-center gap-1">
          {kinds.slice(0, 4).map((k) => {
            const Icon = TOOL_ICON[k] ?? CircleIcon;
            return <Icon key={k} className="size-3.5" />;
          })}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px]">{summarise(items)}</span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[10px]">
          {open ? "hide" : `${calls.length} calls`}
          <ChevronDownIcon className={cn("size-3 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-l pl-3">
          {items.map((item) =>
            item.kind === "tool" ? (
              <ToolCard key={item.id} item={item} />
            ) : (
              // Narration reads the same inside the fold as it does outside it:
              // the same text rendered two different ways in one transcript is
              // a seam the reader has to notice.
              <Markdown
                key={item.id}
                text={item.text ?? ""}
                className={cn(
                  "text-[13px] leading-relaxed break-words",
                  item.contentKind === "thought" ? "text-thought italic" : "text-muted-foreground",
                )}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function receivedTime(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The footer under an agent message: when it arrived, and a one-click copy of
 * the raw text. Quiet by design — metadata should not compete with the prose —
 * so it fades in on hover on a desktop and stays small everywhere.
 */
function MessageMeta({ item }: { item: Item }) {
  const [copied, setCopied] = useState(false);
  const time = receivedTime(item.receivedAt);
  if (!time && !item.text) return null;

  const copy = () => {
    navigator.clipboard?.writeText(item.text ?? "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="text-muted-foreground -mt-2 flex items-center gap-1.5 text-[10px] opacity-60 transition-opacity md:opacity-0 md:group-hover:opacity-60 md:group-focus-within:opacity-60">
      {time && <span className="font-mono">{time}</span>}
      <button
        type="button"
        onClick={copy}
        aria-label="Copy message"
        className="hover:text-foreground focus-visible:ring-ring flex cursor-pointer items-center gap-1 rounded-sm outline-none focus-visible:ring-2"
      >
        {copied ? <CheckIcon className="text-success size-3" /> : <CopyIcon className="size-3" />}
        {copied ? "copied" : "copy"}
      </button>
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
      <Markdown
        text={text}
        className="fade-in text-thought border-l-2 pl-3 text-[13px] leading-relaxed break-words italic"
      />
    );
  }

  return (
    <div className="group flex flex-col gap-2">
      <Markdown
        text={text}
        className={cn(
          "fade-in text-[14px] leading-relaxed break-words",
          // The caret belongs at the end of the prose, not below it, so it
          // hangs off the last block rather than the message container.
          streaming && "caret-block",
        )}
      />
      {/* The footer arrives with the message's end: while streaming, the time
          would claim an arrival that has not happened yet. */}
      {!streaming && <MessageMeta item={item} />}
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
          className="focus-visible:ring-ring min-h-11 min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 md:min-h-0"
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
  onOpenDiff,
}: {
  state: SessionState;
  onRetryProvision: () => void;
  onCleanup: () => void;
  onForceDelete: () => void;
  onContinue: () => void;
  onOpenDiff: (path?: string) => void;
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
  // settled and renders in full. A block the harness opened but never filled is
  // not it: nothing of it is on screen, so treating it as the growing one would
  // leave the turn looking idle while the agent works.
  const lastAgentId = useMemo(() => {
    for (let i = state.items.length - 1; i >= 0; i--) {
      const it = state.items[i];
      if (it.kind === "message" && it.role === "agent" && (it.text ?? "").trim() !== "") return it.id;
    }
    return undefined;
  }, [state.items]);

  const rows = useMemo(() => groupRows(state.items), [state.items]);

  // Only the newest turn can be continued, and only once nothing is running:
  // an error further back was already answered by whatever came after it.
  const interrupted = useMemo(() => {
    if (state.closed || state.phase === "turn") return undefined;
    const last = state.turns[state.turns.length - 1];
    return last?.done && last.stopReason === "error" ? last : undefined;
  }, [state.turns, state.phase, state.closed]);

  // What each turn changed, to be shown under the turn that changed it. A turn
  // that changed nothing has no entry, and gets no card.
  const turnDiffs = useMemo(
    () => new Map(state.turns.filter((t) => t.diff).map((t) => [t.id, t.diff!])),
    [state.turns],
  );
  const lastTurnID = state.turns[state.turns.length - 1]?.id;

  const recoveredTurns = useMemo(
    () => new Set(state.turns.filter((t) => t.recovery).map((t) => t.id)),
    [state.turns],
  );

  return (
    <div ref={ref} className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {/* The floating composer overlays the tail, so the content ends with
          enough room that the last message can scroll clear of it. */}
      <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-3.5 px-4 pt-6 pb-36 md:px-5">
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

        {rows.map((row, i) => {
          const key = row.kind === "group" ? row.id : row.item.id;
          // The card goes after the last row of the turn it describes, which is
          // the row whose successor belongs to a different turn.
          const turnID = rowTurnID(row);
          const nextTurnID = i + 1 < rows.length ? rowTurnID(rows[i + 1]) : undefined;
          const diff = turnID && turnID !== nextTurnID ? turnDiffs.get(turnID) : undefined;

          return (
            <Fragment key={key}>
              {row.kind === "group" ? (
                <ToolGroup items={row.items} />
              ) : row.item.kind === "tool" ? (
                <ToolCard item={row.item} />
              ) : (
                <Message
                  item={row.item}
                  streaming={state.phase === "turn" && row.item.id === lastAgentId}
                  recovered={!!row.item.turnId && recoveredTurns.has(row.item.turnId)}
                />
              )}
              {diff && (
                <ChangedFiles diff={diff} latest={turnID === lastTurnID} onOpenDiff={onOpenDiff} />
              )}
            </Fragment>
          );
        })}

        {state.phase === "turn" && lastAgentId === undefined && (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner className="text-primary size-3.5" /> thinking…
          </div>
        )}

        {interrupted && <InterruptedCard turn={interrupted} onContinue={onContinue} />}
      </div>
    </div>
  );
}
