import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ContextMeter } from "~/components/ContextMeter";
import { ModelPicker } from "~/components/ModelPicker";
import { Button } from "~/components/ui/button";
import type { HarnessMeta, Usage } from "~/protocol";
import { useIsDesktop } from "~/useMediaQuery";

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
  usage,
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
  /** The session's token usage, source of the context meter. */
  usage?: Usage;
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
          {usage && (usage.contextUsed ?? 0) > 0 && <ContextMeter usage={usage} model={model} />}

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
