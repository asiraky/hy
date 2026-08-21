// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Transcript } from "./Transcript";
import { render } from "~/test/harness";

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

  // hy is routinely reached over plain http on a LAN address, which is not a
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
