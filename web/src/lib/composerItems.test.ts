import { describe, expect, it } from "vitest";

import type { ComposerItem } from "~/protocol";
import {
  detectComposerTrigger,
  rankComposerItems,
  replaceComposerTrigger,
  submittedComposerAction,
} from "./composerItems";

const items: ComposerItem[] = [
  { id: "model", name: "model", kind: "command", trigger: "/", insertText: "/model", behavior: "client-action", action: "model" },
  { id: "review", name: "review-code", description: "Inspect changes", kind: "skill", trigger: "$", insertText: "$review-code", behavior: "prompt" },
];

describe("composer item logic", () => {
  it("detects slash only at the start of a line and skills at token boundaries", () => {
    expect(detectComposerTrigger("/mo", 3, items)).toMatchObject({ trigger: "/", query: "mo", start: 0 });
    expect(detectComposerTrigger("ask /mo", 7, items)).toBeNull();
    expect(detectComposerTrigger("ask $rev", 8, items)).toMatchObject({ trigger: "$", query: "rev", start: 4 });
    expect(detectComposerTrigger("ask$rev", 7, items)).toBeNull();
  });

  it("ranks names and replaces only the active token", () => {
    const trigger = detectComposerTrigger("please $rev later", 11, items)!;
    expect(rankComposerItems(items, trigger)[0]?.id).toBe("review");
    expect(replaceComposerTrigger("please $rev later", trigger, "$review-code ")).toEqual({
      value: "please $review-code  later",
      cursor: 20,
    });
  });

  it("replaces the whole token when the caret is in its middle", () => {
    const trigger = detectComposerTrigger("ask $rev|iew later".replace("|", ""), 8, items)!;
    expect(replaceComposerTrigger("ask $review later", trigger, "$review-code ").value).toBe(
      "ask $review-code  later",
    );
    const slash = detectComposerTrigger("/model", 3, items)!;
    expect(replaceComposerTrigger("/model", slash, "").value).toBe("");
  });

  it("intercepts standalone actions but not prompt entries", () => {
    expect(submittedComposerAction(" /model ", items)?.item.id).toBe("model");
    expect(submittedComposerAction("$review-code", items)).toBeNull();
  });
});
