// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "~/lib/clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("uses the async clipboard when the page is a secure context", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyText("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  // Over plain http — a LAN address on a phone — `navigator.clipboard` does
  // not exist at all. The button used to no-op there.
  it("falls back to execCommand when there is no clipboard object", async () => {
    vi.stubGlobal("navigator", {});
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;

    await copyText("hello");

    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back when the async clipboard rejects", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;

    await copyText("hello");

    expect(exec).toHaveBeenCalledWith("copy");
  });

  // Silence is the whole bug: a copy that cannot happen has to say so, so the
  // caller can show it.
  it("throws when both paths fail", async () => {
    vi.stubGlobal("navigator", {});
    document.execCommand = vi.fn().mockReturnValue(false);

    await expect(copyText("hello")).rejects.toThrow(/blocked/);
  });
});
