import { useEffect, useRef, useState } from "react";
import { useIsDesktop } from "../useMediaQuery";
import { Button, Spinner } from "./ui";

export function Composer({
  disabled,
  busy,
  onSend,
  onCancel,
}: {
  disabled: boolean;
  busy: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  // There is no ⌘ key on a phone, so do not advertise the shortcut there.
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
    <div className="border-t border-ink-800 bg-ink-900/40 px-4 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] md:px-5">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2 rounded-xl border border-ink-800 bg-ink-900 p-2 focus-within:border-accent/40">
          <textarea
            ref={ref}
            rows={1}
            value={text}
            disabled={disabled}
            placeholder={
              disabled ? "Session closed" : isDesktop ? "Ask anything…  (⌘↵ to send)" : "Ask anything…"
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            className="scroll-thin max-h-[200px] min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[16px] leading-relaxed text-ink-100 placeholder:text-ink-500 focus:outline-none md:text-[14px]"
          />

          {busy ? (
            <Button variant="danger" onClick={onCancel} title="Interrupt the running turn">
              <Spinner /> Stop
            </Button>
          ) : (
            <Button variant="primary" disabled={disabled || !text.trim()} onClick={send}>
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
