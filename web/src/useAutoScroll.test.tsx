// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAutoScroll } from "./useAutoScroll";

// jsdom does no layout, so the scroller's geometry is stated outright: a
// 1000px column in a 400px window, which is exactly the arithmetic the hook
// does and nothing more.
const CONTENT = 1000;
const VIEWPORT = 400;
const BOTTOM = CONTENT - VIEWPORT;

let stick: () => void;
let scrollToBottom: () => void;

function Harness() {
  const auto = useAutoScroll<HTMLDivElement, HTMLDivElement>();
  stick = auto.stick;
  scrollToBottom = auto.scrollToBottom;
  return (
    <>
      <div ref={auto.scrollerRef} data-testid="scroller">
        <div ref={auto.contentRef} />
      </div>
      <span data-testid="pinned">{String(auto.pinned)}</span>
    </>
  );
}

function scroller() {
  return screen.getByTestId("scroller");
}

function pinned() {
  return screen.getByTestId("pinned").textContent === "true";
}

function setTop(top: number) {
  scroller().scrollTop = top;
}

function fire(event: Event) {
  act(() => {
    scroller().dispatchEvent(event);
  });
}

function settle(fn: () => void) {
  act(fn);
}

function scrollTo(top: number) {
  setTop(top);
  fire(new Event("scroll"));
}

function wheel(deltaY: number) {
  fire(new WheelEvent("wheel", { deltaY }));
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  render(<Harness />);
  const el = scroller();
  Object.defineProperty(el, "scrollHeight", { value: CONTENT, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: VIEWPORT, configurable: true });
  // A real scroller clamps: the position cannot pass the last screenful, so
  // "scroll to scrollHeight" lands at BOTTOM and stays there.
  let top = BOTTOM;
  Object.defineProperty(el, "scrollTop", {
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, el.scrollHeight - VIEWPORT));
    },
    configurable: true,
  });
  el.scrollTo = vi.fn();
  // The mount snap has already happened by now in a browser; this is the
  // scroll event it would have produced.
  fire(new Event("scroll"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useAutoScroll", () => {
  it("starts pinned", () => {
    expect(pinned()).toBe(true);
  });

  it("follows content that grows underneath it while pinned", () => {
    Object.defineProperty(scroller(), "scrollHeight", { value: CONTENT + 400, configurable: true });
    settle(stick);
    expect(pinned()).toBe(true);
    expect(scroller().scrollTop).toBe(CONTENT + 400 - VIEWPORT);
  });

  it("unpins on a wheel scroll upwards", () => {
    wheel(-40);
    expect(pinned()).toBe(false);
  });

  it("ignores a wheel scroll downwards", () => {
    wheel(40);
    expect(pinned()).toBe(true);
  });

  it("unpins when the position drops with no event of its own", () => {
    // A scrollbar drag: the position moves and nothing else says so.
    scrollTo(BOTTOM - 200);
    expect(pinned()).toBe(false);
  });

  it("leaves the view alone once unpinned", () => {
    scrollTo(BOTTOM - 200);
    settle(stick);
    expect(scroller().scrollTop).toBe(BOTTOM - 200);
  });

  it("stays unpinned after a nudge too small to leave the bottom tolerance", () => {
    wheel(-5);
    setTop(BOTTOM - 5);
    fire(new Event("scroll"));
    expect(pinned()).toBe(false);
  });

  it("unpins when content is dragged away underneath the pin", () => {
    // A scrollbar drag during a stream: the position moves, and content
    // arrives before the scroll event does.
    setTop(BOTTOM - 200);
    settle(stick);
    expect(pinned()).toBe(false);
    expect(scroller().scrollTop).toBe(BOTTOM - 200);
  });

  it("stays pinned when shrinking content clamps the position", () => {
    // A tool card closing: the view has nowhere to be but the new bottom.
    Object.defineProperty(scroller(), "scrollHeight", { value: 500, configurable: true });
    setTop(100);
    fire(new Event("scroll"));
    settle(stick);
    expect(pinned()).toBe(true);
  });

  it("ignores intent on a transcript that does not scroll", () => {
    Object.defineProperty(scroller(), "scrollHeight", { value: VIEWPORT, configurable: true });
    wheel(-40);
    fire(new KeyboardEvent("keydown", { key: "PageUp" }));
    expect(pinned()).toBe(true);
  });

  it("re-pins when the reader scrolls back to the bottom", () => {
    scrollTo(BOTTOM - 200);
    scrollTo(BOTTOM);
    expect(pinned()).toBe(true);
  });

  it("re-pins and animates when the button is used", () => {
    scrollTo(BOTTOM - 200);
    settle(scrollToBottom);
    expect(pinned()).toBe(true);
    expect(scroller().scrollTo).toHaveBeenCalledWith({ top: CONTENT, behavior: "smooth" });
  });

  it("jumps instead of animating under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    scrollTo(BOTTOM - 200);
    settle(scrollToBottom);
    expect(scroller().scrollTo).not.toHaveBeenCalled();
    expect(scroller().scrollTop).toBe(BOTTOM);
  });

  it("unpins on a touch drag downwards", () => {
    const touch = (clientY: number) => [{ clientY } as Touch];
    fire(new TouchEvent("touchstart", { touches: touch(200) }));
    fire(new TouchEvent("touchmove", { touches: touch(260) }));
    expect(pinned()).toBe(false);
  });

  it("unpins on a key that scrolls upwards", () => {
    fire(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
    expect(pinned()).toBe(false);
  });
});
