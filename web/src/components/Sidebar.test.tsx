// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./Sidebar";
import { render, viewport } from "~/test/harness";
import type { SessionMeta } from "~/protocol";

const session = (id: string, over: Partial<SessionMeta> = {}): SessionMeta =>
  ({
    id,
    title: `Session ${id}`,
    phase: "idle",
    updatedAt: Date.now(),
    cwd: "/tmp/repo",
    harness: "claude",
    projectId: "p1",
    branch: "main",
    ...over,
  }) as SessionMeta;

const confirmDelete = (id: string) =>
  fireEvent.click(screen.getByRole("button", { name: `Delete session Session ${id}` }));
const checkbox = () => screen.queryByRole("checkbox", { name: /Also delete the worktree/ });

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
    projectRoot: () => "/tmp/repo",
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

  it("offers the worktree removal as a checkbox, ticked for one hy provisioned", () => {
    const managed = session("a", { workspaceMode: "managed", cwd: "/tmp/repo/.worktrees/a" });
    const props = renderSidebar({ sessions: [managed], activeId: "a" });

    confirmDelete("a");
    const box = checkbox();
    expect(box).not.toBeNull();
    expect(box!.getAttribute("data-state")).toBe("checked");
    expect(screen.getByText("/tmp/repo/.worktrees/a")).toBeTruthy();
    // Branches are never deleted, and the copy says so.
    expect(screen.getByText(/is kept either way/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("a", true);
  });

  it("keeps the worktree when the box is unticked", () => {
    const managed = session("a", { workspaceMode: "managed", cwd: "/tmp/repo/.worktrees/a" });
    const props = renderSidebar({ sessions: [managed], activeId: "a" });

    confirmDelete("a");
    fireEvent.click(checkbox()!);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("a", false);
  });

  it("defaults a borrowed worktree to staying, and says hy did not make it", () => {
    const borrowed = session("a", { workspaceMode: "borrowed", cwd: "/tmp/elsewhere" });
    const props = renderSidebar({ sessions: [borrowed], activeId: "a" });

    confirmDelete("a");
    expect(checkbox()!.getAttribute("data-state")).toBe("unchecked");
    expect(screen.getByText(/hy did not create this worktree/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("a", false);
  });

  it("does not offer removal while another session is still in the worktree", () => {
    const shared = { workspaceMode: "managed", cwd: "/tmp/repo/.worktrees/a" };
    const props = renderSidebar({
      sessions: [session("a", shared), session("b", shared)],
      activeId: "a",
    });

    confirmDelete("a");
    expect(checkbox()).toBeNull();
    expect(screen.getByText(/1 other session/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("a", false);
  });

  it("tells a main-checkout session its checkout is untouched, and offers no box", () => {
    const props = renderSidebar({
      sessions: [session("a", { workspaceMode: "local" })],
      activeId: "a",
    });

    confirmDelete("a");
    expect(checkbox()).toBeNull();
    expect(screen.getByText(/checkout is left untouched/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("a", false);
  });

  it("offers no removal for a managed session that never got a worktree", () => {
    // Provisioning failed before `git worktree add` ran, so cwd is still the
    // project root — which the server refuses to remove.
    const props = renderSidebar({
      sessions: [session("a", { workspaceMode: "managed", phase: "provision_failed" })],
      activeId: "a",
    });

    confirmDelete("a");
    expect(checkbox()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("a", false);
  });

  it("counts a closed session as still referencing the worktree", () => {
    const shared = { workspaceMode: "managed", cwd: "/tmp/repo/.worktrees/a" };
    const props = renderSidebar({
      sessions: [session("a", shared), session("b", { ...shared, phase: "closed" })],
      activeId: "a",
    });

    confirmDelete("a");
    // hy still knows of b and b still names that path.
    expect(checkbox()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("a", false);
  });
});
