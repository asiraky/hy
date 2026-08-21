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
  // not exist at all. The button used to no-op there. Asserting only that
  // execCommand was called would pass against a field that was never focused
  // or selected, which copies nothing in Blink, so this checks the state the
  // command actually reads.
  it("focuses and selects the field before copying, with no clipboard object", async () => {
    vi.stubGlobal("navigator", {});
    let selected: string | null = null;
    document.execCommand = vi.fn(() => {
      const field = document.activeElement as HTMLTextAreaElement | null;
      selected =
        field instanceof HTMLTextAreaElement
          ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)
          : null;
      return true;
    });

    await copyText("hello");

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(selected).toBe("hello");
    expect(document.querySelector("textarea")).toBeNull();
  });

  // The scratch field steals focus to hold the selection; the composer has to
  // get it back, or copying a message drops the reader's cursor.
  it("restores the previously focused element", async () => {
    vi.stubGlobal("navigator", {});
    document.execCommand = vi.fn().mockReturnValue(true);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    await copyText("hello");

    expect(document.activeElement).toBe(input);
    input.remove();
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

  // Blink returns true from execCommand("copy") even when the selection is
  // empty and nothing was written. Trusting that would show "Copied" over an
  // unchanged clipboard — the original bug wearing a checkmark.
  it("throws rather than claim success when the selection did not take", async () => {
    vi.stubGlobal("navigator", {});
    document.execCommand = vi.fn().mockReturnValue(true);
    const setSelectionRange = vi
      .spyOn(HTMLTextAreaElement.prototype, "setSelectionRange")
      .mockImplementation(() => {});

    await expect(copyText("hello")).rejects.toThrow(/blocked/);
    expect(document.execCommand).not.toHaveBeenCalled();
    setSelectionRange.mockRestore();
  });
});
