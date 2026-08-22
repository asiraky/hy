// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Transcript } from "./Transcript";
import { render, viewport, wrap } from "~/test/harness";
import type { PullRequest } from "~/protocol";

const state = (text: string): any => ({
  sessionId: "a",
  seq: 1,
  cwd: "/tmp/repo",
  harness: "claude",
  model: "",
  mode: "default",
  effort: "",
  title: "Session a",
  phase: "idle",
  closed: false,
  workspace: { phase: "ready", projectId: "p1", projectRoot: "/tmp/repo" },
  items: [{ id: "m1", kind: "message", role: "agent", contentKind: "text", text, receivedAt: 1 }],
  turns: [{ id: "t1", status: "done" }],
  plan: [],
  usage: {},
  pendingPermissions: [],
  pendingElicitations: [],
});

function transcript(text: string) {
  return render(
    <Transcript
      state={state(text)}
      onRetryProvision={() => {}}
      onCleanup={() => {}}
      onForceDelete={() => {}}
      onContinue={() => {}}
      onOpenDiff={() => {}}
      onFinish={() => {}}
    />,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("copying an agent message", () => {
  it("copies the raw markdown, not the rendered text", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    transcript("# Title\n\n**bold** and `code`");
    fireEvent.click(screen.getByLabelText("Copy message"));

    expect(writeText).toHaveBeenCalledWith("# Title\n\n**bold** and `code`");
  });

  // omniplex is routinely reached over plain http on a LAN address, which is not a
  // secure context: there is no `navigator.clipboard` there at all. The copy
  // has to happen anyway rather than dying silently under a thumb.
  it("still copies with no clipboard API — an http origin on a phone", () => {
    vi.stubGlobal("navigator", {});
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;

    transcript("hello");
    fireEvent.click(screen.getByLabelText("Copy message"));

    expect(exec).toHaveBeenCalledWith("copy");
  });
});

// A prompt sent into a session on screen is lifted to the top of the view so
// the answer streams into the space below it. Which prompts count as "just
// sent" is this component's rule — the hook is told what to hold, not when.
//
// jsdom lays nothing out, so the geometry is stated outright: a 600px
// transcript in a 400px window, with the prompt 500px into it.
const VIEW = 400;
const HEIGHT = 600;
const PROMPT_TOP = 500;
// The room the anchor has to reserve to lift a prompt that far up.
const RESERVE = `${VIEW - (HEIGHT - (PROMPT_TOP - 16))}px`;

const prompts = (ids: string[], sessionId = "a"): any => ({
  ...state(""),
  sessionId,
  items: ids.map((id) => ({ id, kind: "message", role: "user", text: id, receivedAt: 1 })),
});

function view(s: any) {
  return (
    <Transcript
      state={s}
      onFinish={() => {}}
      onRetryProvision={() => {}}
      onCleanup={() => {}}
      onForceDelete={() => {}}
      onContinue={() => {}}
      onOpenDiff={() => {}}
    />
  );
}

// What the transcript is asking its padding to add — "" when nothing is held.
function reserve(container: HTMLElement) {
  const content = container.querySelector<HTMLElement>(".overflow-y-auto > div");
  return content?.style.getPropertyValue("--anchor-reserve") ?? "";
}

// Give the transcript a body: a scroller that clamps its position the way a
// real one does, whose height includes the room the anchor reserves, and a
// prompt whose box moves with the scroll.
function measured(container: HTMLElement) {
  const el = container.querySelector<HTMLElement>(".overflow-y-auto")!;
  const height = () => HEIGHT + parseInt(reserve(container) || "0", 10);
  let top = 0;
  Object.defineProperty(el, "scrollHeight", { get: height, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: VIEW, configurable: true });
  Object.defineProperty(el, "scrollTop", {
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, height() - VIEW));
    },
    configurable: true,
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return { top: this.hasAttribute("data-msg-id") ? PROMPT_TOP - top : 0 } as DOMRect;
  });
  return el;
}

describe("lifting a just-sent prompt", () => {
  it("anchors a prompt that arrives while the session is on screen", () => {
    const { container, rerender } = render(view(prompts(["p1"])));
    const el = measured(container);

    rerender(wrap(view(prompts(["p1", "p2"]))));

    expect(reserve(container)).toBe(RESERVE);
    expect(el.scrollTop).toBe(PROMPT_TOP - 16);
  });

  it("anchors the first prompt of a session that had none", () => {
    const { container, rerender } = render(view(prompts([])));
    measured(container);

    rerender(wrap(view(prompts(["p1"]))));

    expect(reserve(container)).toBe(RESERVE);
  });

  it("leaves a session that was only just opened where it is", () => {
    // Switching sessions changes the newest prompt too — the whole transcript
    // arrives at once — and nobody asked for that view to move.
    const { container, rerender } = render(view(prompts(["p1"])));
    measured(container);

    rerender(wrap(view(prompts(["p9"], "b"))));

    expect(reserve(container)).toBe("");
  });
});

// A worktree session whose branch has landed is offered a way out of the
// transcript it is being read in.
function merged(pr: PullRequest | null, onFinish = () => {}) {
  return render(
    <Transcript
      state={state("done")}
      onRetryProvision={() => {}}
      onCleanup={() => {}}
      onForceDelete={() => {}}
      onContinue={() => {}}
      onOpenDiff={() => {}}
      pr={pr}
      onFinish={onFinish}
    />,
  );
}

const MERGED: PullRequest = {
  number: 75,
  state: "MERGED",
  merged: true,
  mergedAt: "2026-08-20T01:02:03Z",
};

describe("the merged-pull-request prompt", () => {
  it("offers to finish the session once the branch has landed", () => {
    merged(MERGED);
    expect(screen.getByRole("button", { name: /finish with this session/i })).toBeTruthy();
    expect(screen.getByText("PR #75 merged")).toBeTruthy();
  });

  it("says nothing while the pull request is still open", () => {
    merged({ number: 75, state: "OPEN", merged: false });
    expect(screen.queryByRole("button", { name: /finish with this session/i })).toBeNull();
  });

  it("says nothing when there is no pull request to speak of", () => {
    merged(null);
    expect(screen.queryByRole("button", { name: /finish with this session/i })).toBeNull();
  });

  it("opens the confirmation rather than deleting anything itself", () => {
    const onFinish = vi.fn();
    merged(MERGED, onFinish);
    fireEvent.click(screen.getByRole("button", { name: /finish with this session/i }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("still names the offer on a phone, where there is no hover to explain it", () => {
    viewport("phone");
    merged(MERGED);
    // The tooltip does not render on a coarse pointer, so the accessible name
    // is the whole explanation and has to carry it alone.
    expect(screen.getByRole("button", { name: /finish with this session/i })).toBeTruthy();
  });
});
