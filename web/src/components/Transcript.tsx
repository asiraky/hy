import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

function Message({ item, streaming }: { item: Item; streaming: boolean }) {
  // Paced reveal, so a harness that delivers a line at a time still reads as
  // continuous output. Inactive messages render whole.
  const text = useSmoothText(item.text ?? "", streaming);

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

export function Transcript({ state }: { state: SessionState }) {
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

  return (
    <div ref={ref} className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-3.5 px-4 py-6 md:px-5">
        {state.items.length === 0 && (
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
