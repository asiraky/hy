// @vitest-environment jsdom
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, viewport } from "~/test/harness";
import type { ClientEvents } from "./client";
import type { SessionMeta } from "./protocol";

// The socket is the app's only source of truth, so the tests own it: this
// captures the callbacks App hands the client and lets each test decide when
// the session list arrives — which is the whole subject of these tests.
let events: ClientEvents;
const command = vi.fn(async () => ({}) as any);
const attach = vi.fn();

vi.mock("./client", () => ({
  wsURL: () => "ws://test",
  Client: class {
    constructor(_url: string, e: ClientEvents) {
      events = e;
    }
    connect() {
      events.onStatus("online");
    }
    close() {}
    detach() {}
    attach = attach;
    command = command;
  },
}));

const { App } = await import("./App");

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

/** The mobile sidebar is a sheet; its presence in the DOM is "open". */
const sidebarShowing = () => document.querySelector("[data-slot=sheet-content]") !== null;

beforeEach(() => {
  localStorage.clear();
  command.mockClear();
  attach.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("landing on a phone", () => {
  it("lands on the session list when there is nothing to restore", async () => {
    viewport("phone");
    render(<App />);
    await act(async () => events.onSessions([session("a")]));

    expect(sidebarShowing()).toBe(true);
  });

  it("still lands on the session list when there are no sessions at all", async () => {
    viewport("phone");
    render(<App />);
    await act(async () => events.onSessions([]));

    expect(sidebarShowing()).toBe(true);
    expect(screen.getByText("All caught up")).toBeTruthy();
  });

  it("restores straight into the last session without flashing the list open", async () => {
    localStorage.setItem("hy.lastSession", "a");
    viewport("phone");
    render(<App />);

    // Before the list lands we do not yet know whether "a" still exists, so
    // the sidebar must not be shown only to be shut a frame later.
    expect(sidebarShowing()).toBe(false);

    await act(async () => events.onSessions([session("a")]));
    expect(attach).toHaveBeenCalledWith("a");
    expect(sidebarShowing()).toBe(false);
  });

  it("falls back to the list when the stored session is gone", async () => {
    localStorage.setItem("hy.lastSession", "gone");
    viewport("phone");
    render(<App />);
    await act(async () => events.onSessions([session("a")]));

    expect(attach).not.toHaveBeenCalled();
    await waitFor(() => expect(sidebarShowing()).toBe(true));
  });

  it("says nothing while it is still deciding", async () => {
    localStorage.setItem("hy.lastSession", "a");
    viewport("phone");
    render(<App />);

    // Neither empty-state message: both would be contradicted a moment later.
    expect(screen.queryByText("All caught up")).toBeNull();
    expect(screen.queryByText("Nothing open")).toBeNull();
    expect(screen.getByText("Reopening your last session…")).toBeTruthy();
  });
});

describe("the empty content column", () => {
  it("points at the list when there are sessions to pick from", async () => {
    viewport("desktop");
    render(<App />);
    await act(async () => events.onSessions([session("a")]));

    expect(screen.getByText("Nothing open")).toBeTruthy();
    // The action is still offered, but quietly: no oversized call to action
    // competing with the list of sessions beside it.
    const cta = screen
      .getAllByRole("button", { name: /New session/ })
      .find((b) => b.textContent?.includes("New session"))!;
    expect(cta.getAttribute("data-size")).toBe("sm");
    expect(cta.getAttribute("data-variant")).toBe("outline");
  });

  it("congratulates you when there is nothing at all", async () => {
    viewport("desktop");
    render(<App />);
    await act(async () => events.onSessions([]));

    expect(screen.getByText("All caught up")).toBeTruthy();
    expect(
      screen.getByText("Nothing is running. Put your feet up — or start something new."),
    ).toBeTruthy();
  });
});
