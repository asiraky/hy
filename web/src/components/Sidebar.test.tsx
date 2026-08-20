// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./Sidebar";
import { render, viewport } from "~/test/harness";
import type { SessionMeta } from "~/protocol";

const session = (id: string): SessionMeta =>
  ({
    id,
    title: `Session ${id}`,
    phase: "idle",
    updatedAt: Date.now(),
    cwd: "/tmp/repo",
    harness: "claude",
    projectId: "p1",
    branch: "main",
  }) as SessionMeta;

function renderSidebar(over: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props = {
    sessions: [session("a"), session("b")],
    activeId: null as string | null,
    status: "online" as const,
    open: true,
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onDelete: vi.fn(),
    onShowAccess: vi.fn(),
    accentOf: () => undefined,
    projectName: () => "repo",
    ...over,
  };
  render(<Sidebar {...props} />);
  return props;
}

afterEach(() => vi.unstubAllGlobals());

describe("Sidebar", () => {
  it("offers no collapse control on a phone with nothing selected", () => {
    viewport("phone");
    renderSidebar({ activeId: null });

    expect(screen.getByRole("button", { name: "New session" })).toBeTruthy();
    // Nothing behind the panel to collapse back to.
    expect(screen.queryByRole("button", { name: "Hide sessions" })).toBeNull();
    // And no second, differently-shaped close control in the same corner.
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("offers the collapse control on a phone once a session is selected", () => {
    viewport("phone");
    renderSidebar({ activeId: "a" });

    expect(screen.getByRole("button", { name: "Hide sessions" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("always offers the collapse control when docked", () => {
    viewport("desktop");
    renderSidebar({ activeId: null });

    expect(screen.getByRole("button", { name: "Hide sessions" })).toBeTruthy();
  });

  it("fills the viewport on a phone rather than leaving a sliver behind", () => {
    viewport("phone");
    renderSidebar({ activeId: "a" });

    const panel = document.querySelector("[data-slot=sheet-content]");
    expect(panel?.className).toContain("w-screen");
    expect(panel?.className).toContain("max-w-none");
    // The sheet's own base classes cap it at 24rem from `sm` up, which would
    // leave a 384px panel on a landscape phone — still below `md`, so still
    // inside this branch.
    expect(panel?.className).toContain("sm:max-w-none");
  });

  it("keeps the delete target thumb-sized without moving the glyph", () => {
    viewport("phone");
    renderSidebar({ activeId: "a" });

    const del = screen.getAllByRole("button", { name: /^Delete session/ })[0];
    // The square stays 32px so it stays aligned with the logo below it; the
    // hit area is grown around it instead. 32 + 2*6 = 44.
    expect(del.className).toContain("size-8");
    expect(del.className).toContain("after:-inset-1.5");
    expect(del.className).toContain("md:after:hidden");
  });

  it("puts the collapse control right after the new-session button, as when docked", () => {
    viewport("phone");
    renderSidebar({ activeId: "a" });
    const names = Array.from(document.querySelectorAll("[data-slot=sheet-content] button"))
      .map((b) => b.getAttribute("aria-label"))
      .filter(Boolean);
    // Adjacent, in that order — the docked panel's arrangement, not a lone X
    // floating in the corner above it.
    expect(names.indexOf("Hide sessions")).toBe(names.indexOf("New session") + 1);
  });
});
