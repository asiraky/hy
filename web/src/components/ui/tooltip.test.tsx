// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render } from "~/test/harness";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

/** Answer the coarse-pointer query, leaving the width query alone. */
function pointer(kind: "coarse" | "fine") {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("pointer: coarse") ? kind === "coarse" : true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

const subject = (
  <Tooltip open>
    <TooltipTrigger aria-label="Do the thing">go</TooltipTrigger>
    <TooltipContent>Do the thing</TooltipContent>
  </Tooltip>
);

afterEach(() => vi.unstubAllGlobals());

describe("Tooltip", () => {
  it("renders nothing on a touch screen", () => {
    pointer("coarse");
    render(subject);

    // Not merely hidden: an invisible tooltip is still a dismissable layer
    // stacked above any sheet or dialog under it, and it would swallow the
    // Escape meant for that sheet.
    expect(document.querySelector("[data-slot=tooltip-content]")).toBeNull();
    // The control still says what it is.
    expect(screen.getByLabelText("Do the thing")).toBeTruthy();
  });

  it("still renders for a pointer that can hover", () => {
    pointer("fine");
    render(subject);

    expect(document.querySelector("[data-slot=tooltip-content]")).not.toBeNull();
  });
});
