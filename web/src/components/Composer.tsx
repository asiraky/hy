import { ArrowUpIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useIsDesktop } from "~/useMediaQuery";

export function Composer({
  disabled,
  busy,
  onSend,
  onCancel,
  disabledPlaceholder,
}: {
  disabled: boolean;
  busy: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  disabledPlaceholder?: string;
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
    <div className="bg-background/80 border-t px-4 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] backdrop-blur md:px-5">
      <div className="mx-auto max-w-3xl">
        <div className="bg-card focus-within:border-ring focus-within:ring-ring/50 flex items-end gap-2 rounded-xl border p-2 transition-[color,box-shadow] focus-within:ring-[3px]">
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
            className="scroll-thin placeholder:text-muted-foreground max-h-[200px] min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[16px] leading-relaxed focus:outline-none disabled:opacity-60 md:text-[14px]"
          />

          {busy ? (
            <Button
              variant="destructive"
              onClick={onCancel}
              title="Interrupt the running turn"
              className="min-h-11 md:min-h-9"
            >
              <Spinner className="size-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              disabled={disabled || !text.trim()}
              onClick={send}
              className="min-h-11 md:min-h-9"
            >
              <ArrowUpIcon />
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
