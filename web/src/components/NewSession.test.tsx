// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, viewport } from "~/test/harness";
import { NewSession, type NewSessionInput } from "./NewSession";
import type { HarnessMeta, Project, Workspace } from "~/protocol";

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
    // The card's width cap has to start where the card does. At `sm` it would
    // still be in force from 640 to 767px, leaving a 448px strip pinned to the
    // left edge by the full-screen inset.
    expect(cls).toContain("md:max-w-md");
    expect(cls).not.toContain("sm:max-w-md");
    // Including the primitive's own default cap, which is dropped rather than
    // overridden for exactly the same reason.
    expect(cls).not.toContain("sm:max-w-lg");
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

  it("offers every workspace scenario as its own choice", async () => {
    open();
    await waitFor(() => screen.getByRole("radio", { name: /Main checkout/ }));
    for (const name of [
      /Main checkout/,
      /New worktree from issue or branch name/,
      /New scratch worktree/,
      /Attach to existing worktree/,
    ]) {
      expect(screen.getByRole("radio", { name })).toBeTruthy();
    }
  });

  it("still offers the main checkout when another session is on it, with an inline warning", async () => {
    const root = {
      path: "/tmp/repo",
      isRoot: true,
      busy: true,
      busyTitle: "the other one",
    } as Workspace;
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const onCreate = vi.fn(async (_input: NewSessionInput) => {});
    open({
      onCreate,
      onListWorkspaces: vi.fn(async () => ({ workspaces: [root], issues: [], issuesError: "" })),
    });

    const choice = await waitFor(() => screen.getByRole("radio", { name: /Main checkout/ }));
    expect(choice.getAttribute("disabled")).toBeNull();
    fireEvent.click(choice);

    // A line of text under the choice, not a modal and not a browser dialog.
    expect(screen.getByText(/already on the main checkout/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(confirm).not.toHaveBeenCalled();
    expect(onCreate.mock.calls[0][0]).toMatchObject({ workspace: "local", branch: "" });
  });

  it("creates a scratch worktree from an explicit choice, not an empty field", async () => {
    const onCreate = vi.fn(async (_input: NewSessionInput) => {});
    open({ onCreate });

    fireEvent.click(await waitFor(() => screen.getByRole("radio", { name: /New scratch worktree/ })));
    // Nothing to fill in, so Start is live straight away.
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      workspace: "managed",
      branch: "",
      workspacePath: "",
    });
  });

  it("sends a per-session base ref for a named worktree", async () => {
    const onCreate = vi.fn(async (_input: NewSessionInput) => {});
    open({ onCreate });

    const field = await waitFor(() => screen.getByRole("combobox", { name: /Branch/ }));
    fireEvent.change(field, { target: { value: "issue/9-stack" } });
    fireEvent.change(screen.getByLabelText("Base"), { target: { value: "feature/underneath" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      workspace: "managed",
      branch: "issue/9-stack",
      baseRef: "feature/underneath",
    });
  });

  it("will not start a named worktree with no name", async () => {
    open();
    await waitFor(() => screen.getByRole("combobox", { name: /Branch/ }));
    expect(screen.getByRole("button", { name: "Start" }).hasAttribute("disabled")).toBe(true);
  });

  it("attaches to a worktree another session is already in, having said so", async () => {
    const side = {
      path: "/tmp/repo/.worktrees/side",
      branch: "issue/1-side",
      busy: true,
      busyTitle: "the other one",
    } as Workspace;
    const onCreate = vi.fn(async (_input: NewSessionInput) => {});
    open({
      onCreate,
      onListWorkspaces: vi.fn(async () => ({ workspaces: [side], issues: [], issuesError: "" })),
    });

    fireEvent.click(
      await waitFor(() => screen.getByRole("radio", { name: /Attach to existing worktree/ })),
    );
    fireEvent.click(screen.getByRole("combobox", { name: /Worktree/ }));
    const row = await waitFor(() => screen.getByRole("option", { name: /issue\/1-side/ }));
    expect(row.hasAttribute("disabled")).toBe(false);
    fireEvent.click(row);

    expect(screen.getByText(/already in this worktree/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      workspace: "",
      workspacePath: side.path,
    });
  });
});
