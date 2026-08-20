import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ModelPicker } from "~/components/ModelPicker";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { HarnessMeta } from "~/protocol";
import { useIsDesktop } from "~/useMediaQuery";

/**
 * The context gauge: a ring that fills as the window does, green while there
 * is room, amber when it is worth wrapping up, red when the next compaction is
 * near. It renders nothing when the harness has not said — a gauge with no
 * reading is noise.
 */
/** 12345 → "12k", 1500000 → "1.5M": token counts want one significant step. */
function fmtTokens(n: number) {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function ContextRing({ pct, used, window: win }: { pct: number; used?: number; window?: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const r = 6;
  const c = 2 * Math.PI * r;
  const tone =
    clamped >= 85 ? "text-destructive" : clamped >= 60 ? "text-attention" : "text-success";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("flex size-8 shrink-0 items-center justify-center", tone)}>
          {/* The ring is decoration; a screen reader gets the reading as text. */}
          <span className="sr-only">Context window {Math.round(clamped)}% used</span>
          <svg aria-hidden viewBox="0 0 16 16" className="size-4 -rotate-90">
            <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" className="stroke-border" />
            <circle
              cx="8"
              cy="8"
              r={r}
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              stroke="currentColor"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - clamped / 100)}
            />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {used && win
          ? `Context ${Math.round(clamped)}% used — ${fmtTokens(used)} / ${fmtTokens(win)} tokens`
          : `Context ${Math.round(clamped)}% used`}
      </TooltipContent>
    </Tooltip>
  );
}

export function Composer({
  disabled,
  busy,
  onSend,
  onCancel,
  disabledPlaceholder,
  harnesses = [],
  harness = "",
  instance = "",
  model = "",
  effort = "",
  onSwitchModel,
  contextPct,
  contextUsed,
  contextWindow,
}: {
  disabled: boolean;
  busy: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  disabledPlaceholder?: string;
  /** Every harness the server reports; the picker reads this session's out. */
  harnesses?: HarnessMeta[];
  /** The attached session's harness and account, which it cannot change. */
  harness?: string;
  instance?: string;
  model?: string;
  effort?: string;
  onSwitchModel?: (id: string) => void;
  /** 0–100, or undefined when the harness has not reported it yet. */
  contextPct?: number;
  /** Raw readings behind contextPct: tokens in the window / window size. */
  contextUsed?: number;
  contextWindow?: number;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  // There is no ⇧↵ worth advertising on a phone, so keep the hint to desktop.
  const isDesktop = useIsDesktop();

  // Grow with the content, up to a cap.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-[calc(0.875rem+env(safe-area-inset-bottom))] md:px-5">
      <div className="bg-card focus-within:border-ring focus-within:ring-ring/50 rounded-2xl border shadow-lg transition-[color,box-shadow] focus-within:ring-[3px]">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          aria-label="Message"
          placeholder={
            disabled
              ? (disabledPlaceholder ?? "Session closed")
              : isDesktop
                ? "Ask anything…  (↵ to send · ⇧↵ for newline)"
                : "Ask anything…"
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // Shift+Enter is the newline; let the textarea handle it.
            if (e.shiftKey) return;
            // Enter confirms an IME candidate (CJK input); it must not send.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            send();
          }}
          // 16px on a phone: anything smaller makes iOS zoom the viewport on
          // focus, which breaks the layout the dvh handling just fixed.
          className="scroll-thin placeholder:text-muted-foreground max-h-[200px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[16px] leading-relaxed focus:outline-none disabled:opacity-60 md:text-[14px]"
        />

        <div className="flex items-center gap-1 px-2.5 pb-2">
          {contextPct !== undefined && contextPct > 0 && (
            <ContextRing pct={contextPct} used={contextUsed} window={contextWindow} />
          )}

          <span className="flex-1" />

          {harnesses.length > 0 && (
            // The same picker the new-session dialog uses, with the account
            // fixed: the harness is already running under it, so only the
            // model is still a choice.
            <ModelPicker
              harnesses={harnesses}
              lockInstance
              disabled={disabled}
              value={{ harness, instance, model }}
              onChange={(next) => onSwitchModel?.(next.model)}
              className="text-muted-foreground hover:text-foreground h-11 w-auto max-w-[45%] min-w-0 border-0 px-2 shadow-none md:h-8 md:min-h-8"
            />
          )}
          {effort && (
            <span className="text-muted-foreground shrink-0 text-[12px] capitalize">{effort}</span>
          )}

          {busy ? (
            <Button
              variant="destructive"
              size="icon"
              onClick={onCancel}
              aria-label="Interrupt the running turn"
              title="Interrupt the running turn"
              className="size-11 rounded-full md:size-8"
            >
              <SquareIcon className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              disabled={disabled || !text.trim()}
              onClick={send}
              aria-label="Send"
              className="size-11 rounded-full md:size-8"
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
