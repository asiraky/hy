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

const atBottom = (el: HTMLElement) =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;

// Nothing to leave, so nothing to read as leaving: a transcript that fits its
// window answers a wheel or a swipe with no movement at all, and taking that
// as intent would strand the pin off and the button on for a view that is
// already showing everything there is.
const canScroll = (el: HTMLElement) => el.scrollHeight - el.clientHeight > AT_BOTTOM_PX;

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
    const el = scrollerRef.current;
    if (!pinnedRef.current || !el) return;
    // A scrollbar drag moves the view and says nothing else about it: its
    // scroll event is queued, and if content arrives first this snap would
    // overwrite the position before anyone read it — the exact fight this
    // hook exists to end. So the position is checked against the one we last
    // wrote before it is written over. A drop that ends at the bottom is not
    // a reader: that is the view being clamped by content going away.
    if (el.scrollTop < lastTop.current - 1 && !atBottom(el)) {
      setPin(false);
      return;
    }
    jumpToBottom();
  }, [jumpToBottom, setPin]);

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

    const onScroll = () => {
      const top = el.scrollTop;
      // A position that went up — under the reader's hand or the scrollbar's
      // — ends the pin, and it does so even a few pixels from the bottom:
      // re-arming inside the tolerance would undo a small deliberate nudge
      // and hand the view straight back to the stream. Movement up that ends
      // at the bottom is not the reader at all, it is the view being clamped
      // by content going away, and it leaves the pin as it found it. Arriving
      // at the bottom any other way re-arms: that is the position the pin
      // itself would hold, so there is nothing left to preserve.
      const movedUp = top < lastTop.current;
      if (movedUp && !atBottom(el)) setPin(false);
      else if (!movedUp && atBottom(el)) setPin(true);
      lastTop.current = top;
    };

    // Wheel, touch and keys are read as intent directly rather than waiting to
    // see the movement. During a fast stream the snap can land in the same
    // frame as the reader's scroll and cancel it out, leaving nothing for the
    // scroll handler to notice; the intent was still real.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && canScroll(el)) setPin(false);
    };

    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      // A finger travelling down the screen drags the content down, which is
      // to say it scrolls the view up.
      if (y > touchY && canScroll(el)) setPin(false);
      touchY = y;
    };

    const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);
    const onKeyDown = (e: KeyboardEvent) => {
      if (UP_KEYS.has(e.key) && canScroll(el)) setPin(false);
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
    // Watch the border box, not the content box: the tail's reserved room is
    // bottom padding that tracks the floating composer, and a composer growing
    // past that headroom would otherwise creep over the tail without ever
    // resizing the content box — so the pin would never re-snap to clear it.
    const ro = new ResizeObserver(() => stick());
    ro.observe(content, { box: "border-box" });
    return () => ro.disconnect();
  }, [stick]);

  return { scrollerRef, contentRef, pinned, stick, scrollToBottom };
}
