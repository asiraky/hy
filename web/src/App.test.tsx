// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, viewport } from "~/test/harness";
import type { ClientEvents } from "./client";
import type { SessionMeta } from "./protocol";

// The socket is the app's only source of truth, so the tests own it: this
// captures the callbacks App hands the client and lets each test decide when
// the session list arrives — which is the whole subject of these tests.
let events: ClientEvents;
const command = vi.fn(async (_name: string, _args: unknown) => ({}) as any);
const attach = vi.fn();
const detach = vi.fn();

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
    detach = detach;
    attach = attach;
    command = command;
  },
}));

const { App } = await import("./App");

const project = {
  id: "p1",
  root: "/tmp/repo",
  config: {
    name: "repo",
    defaults: { harness: "claude", model: "", mode: "", workspace: "local" },
    workspace: {},
  },
} as any;

const harness = {
  id: "claude",
  name: "Claude Code",
  models: [],
  permissionModes: [],
  availability: { state: "ready" },
} as any;

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
  detach.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const state = (id: string, mode: string): any => ({
  sessionId: id,
  seq: 1,
  cwd: "/tmp/repo",
  harness: "claude",
  model: "",
  mode,
  effort: "",
  title: `Session ${id}`,
  phase: "idle",
  closed: false,
  workspace: { phase: "ready", projectId: "p1", projectRoot: "/tmp/repo" },
  items: [],
  turns: [],
  plan: [],
  usage: {},
  pendingPermissions: [],
  pendingElicitations: [],
});

describe("a bypass session is just a session", () => {
  it("opens with no confirmation, banner, or acknowledgement", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    localStorage.setItem("hy.lastSession", "a");
    viewport("desktop");
    render(<App />);
    await act(async () => {
      events.onProjects([project]);
      events.onHarnesses(
        [
          {
            ...harness,
            permissionModes: [
              { id: "default", label: "Default", default: true },
              {
                id: "bypassPermissions",
                label: "Bypass",
                description: "Skip all permission checks",
              },
            ],
          },
        ],
        "/tmp/repo",
      );
      events.onSessions([session("a")]);
      events.onState("a", state("a", "bypassPermissions"));
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(
      /are you sure|without asking you first|acknowledge|proceed with caution/i,
    );
  });
});

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

  it("claims nothing before the list has arrived", () => {
    // No stored session, so nothing to restore — but also no grounds yet for
    // telling someone with six live sessions that they are all caught up.
    viewport("desktop");
    render(<App />);

    expect(screen.queryByText("All caught up")).toBeNull();
    expect(screen.queryByText("Nothing open")).toBeNull();
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

describe("losing the attached session", () => {
  it("lets go even if the session never sent a first snapshot", async () => {
    viewport("phone");
    render(<App />);
    await act(async () => events.onSessions([session("a"), session("b")]));

    // Selecting clears state and waits for the server; deleting a row that is
    // not the open one goes through exactly this path, so a delete landing
    // before the first snapshot used to leave the app attached to nothing and
    // stuck on "Attaching…".
    await act(async () => {
      fireEvent.click(screen.getByText("Session b"));
    });
    expect(attach).toHaveBeenCalledWith("b");

    await act(async () => events.onSessions([session("a")]));

    expect(detach).toHaveBeenCalled();
    // On a phone that leaves nothing behind the sidebar, so it returns.
    expect(sidebarShowing()).toBe(true);
  });

  it("does not let go of a session the list has not caught up with yet", async () => {
    viewport("phone");
    render(<App />);
    await act(async () => {
      events.onSessions([session("a")]);
      events.onProjects([project]);
      events.onHarnesses([harness], "/tmp/repo");
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /New session/ })[0]);
    });
    command.mockImplementation(async (name: string) =>
      name === "create_session" ? { sessionId: "fresh" } : ({} as any),
    );
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    });
    expect(attach).toHaveBeenCalledWith("fresh");

    // Creating attaches before the broadcast carrying the new session
    // arrives, so for a moment the attached id is in no list at all. A list
    // that predates it must not read as "it is gone".
    await act(async () => events.onSessions([session("a")]));
    expect(detach).not.toHaveBeenCalled();
    expect(sidebarShowing()).toBe(false);
  });
});
