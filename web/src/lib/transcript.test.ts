import { describe, expect, it } from "vitest";

import { transcriptMarkdown } from "~/lib/transcript";
import type { Item, Turn } from "~/protocol";

describe("transcriptMarkdown", () => {
  it("formats raw user and assistant prose as markdown", () => {
    const items: Item[] = [
      { id: "u1", kind: "message", role: "user", text: "Try **this**." },
      { id: "a1", kind: "message", role: "agent", contentKind: "text", text: "# Result\n\nDone." },
    ];

    expect(transcriptMarkdown(items, [])).toBe(
      "## User\n\nTry **this**.\n\n## Assistant\n\n# Result\n\nDone.",
    );
  });

  it("omits thoughts, tools, notices, subagents, empty messages, and recovery prompts", () => {
    const items: Item[] = [
      { id: "u1", kind: "message", role: "user", text: "Question" },
      { id: "thought", kind: "message", role: "agent", contentKind: "thought", text: "Private" },
      { id: "tool", kind: "tool", title: "Read" },
      { id: "notice", kind: "notice", noticeKind: "compaction" },
      { id: "child", kind: "message", role: "agent", parentId: "tool", text: "Subagent" },
      { id: "empty", kind: "message", role: "agent", contentKind: "text", text: "  " },
      { id: "recovery", kind: "message", role: "user", turnId: "t2", text: "Continue" },
      { id: "a1", kind: "message", role: "agent", contentKind: "text", text: "Answer" },
    ];
    const turns: Turn[] = [
      { id: "t2", prompt: "Continue", done: true, recovery: { resumeOf: "t1", attempt: 1 } },
    ];

    expect(transcriptMarkdown(items, turns)).toBe(
      "## User\n\nQuestion\n\n## Assistant\n\nAnswer",
    );
  });
});
