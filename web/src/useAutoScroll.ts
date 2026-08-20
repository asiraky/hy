import { useCallback, useEffect, useRef, useState } from "react";

// Following the tail of a transcript is two behaviours pretending to be one:
// the view snaps to the bottom as content arrives, and the reader is allowed
// to leave. A distance-from-the-bottom heuristic on its own cannot tell the
// two apart — a snap and a scroll-up look identical to the scroll event — so
// while text streams the reader loses every argument with it.
//
// This tracks the pin as intent instead. It is broken by anything that reads
// as "the reader moved the view upwards", and re-armed only by arriving at the
// bottom, which either the reader does themselves or the button does for them.

// Arriving at the bottom re-arms the pin. The tolerance is small on purpose:
// a generous band would re-pin a reader who nudged the view a little and
// expected it to stay put. Sub-pixel scroll positions (fractional zoom,
// high-DPI layouts) are why it is not zero.
const AT_BOTTOM_PX = 8;

/**
 * Keeps a scroller pinned to its own bottom while content grows, and gives up
 * the pin the moment the reader scrolls up.
 *
 * `scrollerRef` goes on the scrolling element and `contentRef` on the element
 * inside it whose height changes — text revealed between renders grows the
 * content without React knowing, so the pin has to watch the box, not state.
 * `stick()` is for the cases React does drive; it is a no-op while unpinned.
 */
export function useAutoScroll<S extends HTMLElement, C extends HTMLElement>() {
  const scrollerRef = useRef<S>(null);
  const contentRef = useRef<C>(null);

  // The pin is state because a button hangs off it, and a ref because the
  // scroll and resize handlers below read it outside of React's world.
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(true);

  // The last scroll position we saw. A drop from it is the one signal that
  // catches scrollbar drags, which produce no other event of their own.
  const lastTop = useRef(0);

  const setPin = useCallback((next: boolean) => {
    if (pinnedRef.current === next) return;
    pinnedRef.current = next;
    setPinned(next);
  }, []);

  const jumpToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, []);

  const stick = useCallback(() => {
    if (pinnedRef.current) jumpToBottom();
  }, [jumpToBottom]);

  // The button's action: animate down and take the pin back. Re-arming the pin
  // before the animation finishes is deliberate — content arriving mid-flight
  // should be followed, not chased.
  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setPin(true);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof el.scrollTo !== "function") {
      jumpToBottom();
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [jumpToBottom, setPin]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    // A scroller can mount already scrolled — a restored position, a browser
    // restoring one for us — and the first movement has to be measured from
    // where it actually is rather than from the top.
    lastTop.current = el.scrollTop;

    const atBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;

    const onScroll = () => {
      const top = el.scrollTop;
      // Reaching the bottom always wins: it is the same position the pin
      // itself would hold, so there is nothing left to preserve. Otherwise a
      // position that went up — under the reader's hand or the scrollbar's —
      // ends the pin.
      if (atBottom()) setPin(true);
      else if (top < lastTop.current) setPin(false);
      lastTop.current = top;
    };

    // Wheel, touch and keys are read as intent directly rather than waiting to
    // see the movement. During a fast stream the snap can land in the same
    // frame as the reader's scroll and cancel it out, leaving nothing for the
    // scroll handler to notice; the intent was still real.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) setPin(false);
    };

    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      // A finger travelling down the screen drags the content down, which is
      // to say it scrolls the view up.
      if (y > touchY) setPin(false);
      touchY = y;
    };

    const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);
    const onKeyDown = (e: KeyboardEvent) => {
      if (UP_KEYS.has(e.key)) setPin(false);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
    };
  }, [setPin]);

  // Text is revealed between event ticks, so following the tail has to watch
  // the content's size rather than React state.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => stick());
    ro.observe(content);
    return () => ro.disconnect();
  }, [stick]);

  return { scrollerRef, contentRef, pinned, stick, scrollToBottom };
}
