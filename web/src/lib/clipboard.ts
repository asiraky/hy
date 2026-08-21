import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Copies through the async Clipboard API, falling back to the legacy
 * `execCommand` path.
 *
 * `navigator.clipboard` exists only in a secure context, and hy is routinely
 * reached over plain http on a LAN address — which is exactly where the phone
 * is. There the whole `clipboard` object is undefined, so the obvious
 * `navigator.clipboard?.writeText(...)` reads as "no clipboard, do nothing"
 * and the button dies silently under a thumb. The old selection-based copy
 * still works in that context, so we use it rather than telling the reader
 * their browser cannot copy.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // A permissions policy, a non-user gesture, or Safari losing the user
      // activation across an await — all recoverable by the legacy path.
    }
  }
  if (!legacyCopy(text)) throw new Error("This browser blocked the copy");
}

/**
 * The pre-Clipboard-API copy: select text in an offscreen field, then ask the
 * document to copy the selection.
 *
 * The details are load-bearing on iOS Safari. The field has to be in the
 * layout (not `display:none`) and un-zoomable (`font-size: 16px` avoids the
 * focus zoom), it must be `readonly` so tapping copy cannot raise the
 * keyboard, and the selection has to be made with a Range as well as
 * `setSelectionRange` — Safari ignores the latter alone on a readonly field.
 */
function legacyCopy(text: string): boolean {
  const selection = window.getSelection();
  // Whatever the reader had selected before pressing copy is theirs; put it
  // back rather than leaving our scratch field's selection behind.
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.contentEditable = "true";
  field.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;";
  document.body.appendChild(field);

  try {
    const range = document.createRange();
    range.selectNodeContents(field);
    selection?.removeAllRanges();
    selection?.addRange(range);
    field.setSelectionRange?.(0, text.length);
    return document.execCommand?.("copy") ?? false;
  } catch {
    return false;
  } finally {
    field.remove();
    selection?.removeAllRanges();
    if (previous) selection?.addRange(previous);
  }
}

// How long the button keeps saying "copied" before returning to its resting
// state. Long enough to be read, short enough not to linger over the content.
const COPIED_MS = 1500;

/**
 * Copy state for a button: the transient "copied" flag plus the copy itself,
 * with the feedback both ways. The check on the button is the quiet signal and
 * the toast is the loud one — on a phone the button is often under the thumb
 * that pressed it, so the check alone is a copy the reader cannot see.
 */
export function useCopy(): { copied: boolean; copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string) => {
    try {
      await copyText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      toast.success("Copied");
    } catch (e) {
      toast.error("Could not copy", { description: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  return { copied, copy };
}
