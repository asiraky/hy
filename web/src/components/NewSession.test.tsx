// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, viewport } from "~/test/harness";
import { NewSession } from "./NewSession";
import type { HarnessMeta, Project } from "~/protocol";

const project = {
  id: "p1",
  root: "/tmp/repo",
  config: {
    name: "repo",
    defaults: { harness: "claude", model: "", mode: "", workspace: "managed" },
    workspace: {},
  },
} as unknown as Project;

const harness = {
  id: "claude",
  name: "Claude Code",
  models: [],
  permissionModes: [],
  availability: { state: "ready" },
} as unknown as HarnessMeta;

function open(over: Partial<React.ComponentProps<typeof NewSession>> = {}) {
  render(
    <NewSession
      projects={[project]}
      harnesses={[harness]}
      userConfig={null}
      status="online"
      onCreate={vi.fn()}
      onListWorkspaces={vi.fn(async () => ({ workspaces: [], issues: [], issuesError: "" }))}
      onAddProject={vi.fn()}
      onSettings={vi.fn()}
      onRecheck={vi.fn()}
      onClose={vi.fn()}
      {...over}
    />,
  );
}

const surface = () => document.querySelector("[data-slot=dialog-content]")!;

afterEach(() => vi.unstubAllGlobals());

describe("NewSession", () => {
  it("takes the whole screen on a phone rather than floating as a card", () => {
    viewport("phone");
    open();

    const cls = surface().className;
    expect(cls).toContain("max-md:h-[100dvh]");
    expect(cls).toContain("max-md:w-screen");
    expect(cls).toContain("max-md:rounded-none");
    // A 85dvh cap would fight the full-height rule it sits beside.
    expect(cls).toContain("max-md:max-h-none");
  });

  it("keeps a way out in the corner", () => {
    viewport("phone");
    open();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("keeps Start reachable without scrolling the form back down", () => {
    viewport("phone");
    open();
    // The form is its own scroll container, so the footer below it stays put.
    const scroller = surface().querySelector(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(surface().querySelector("[data-slot=dialog-footer]")).not.toBeNull();
    expect(scroller!.contains(surface().querySelector("[data-slot=dialog-footer]"))).toBe(false);
  });

  it("matches the project select to the buttons beside it", () => {
    open();
    const row = screen.getByRole("combobox", { name: /Project/ }).parentElement!;
    const buttons = Array.from(row.querySelectorAll("button")).filter(
      (b) => b.getAttribute("data-slot") === "button",
    );
    expect(buttons.length).toBe(2);
    // Inheriting the icon size rather than carrying a one-off override is the
    // whole point: these were 32px next to a 36px select.
    for (const b of buttons) {
      expect(b.className).toContain("size-11");
      expect(b.className).toContain("md:size-9");
      expect(b.className).not.toContain("md:size-8");
    }
  });

  it("writes branch names in the interface font, not a terminal one", async () => {
    open();
    const field = await waitFor(() => screen.getByRole("combobox", { name: /Branch/ }));
    expect(field.className).not.toContain("font-mono");
  });
});
