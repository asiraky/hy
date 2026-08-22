import { describe, expect, it } from "vitest";

import { buildGroups } from "./sidebarGroups";
import type { Label, SessionMeta } from "./protocol";

function session(id: string, labelId?: string): SessionMeta {
  return {
    id,
    cwd: "/tmp",
    harness: "h",
    title: id,
    createdAt: 0,
    updatedAt: 0,
    headSeq: 0,
    phase: "idle",
    labelId,
  };
}

function label(id: string, position: number): Label {
  return { id, name: id, color: "#0091ff", position, createdAt: 0 };
}

describe("buildGroups", () => {
  it("returns null with zero labels, so the sidebar stays the flat list", () => {
    expect(buildGroups([session("a")], [])).toBeNull();
  });

  it("groups by label in the given order, unlabelled last", () => {
    const groups = buildGroups(
      [session("s1", "l2"), session("s2"), session("s3", "l1"), session("s4", "l1")],
      [label("l1", 0), label("l2", 1)],
    )!;
    expect(groups.map((g) => g.label?.id ?? null)).toEqual(["l1", "l2", null]);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["s3", "s4"]);
    expect(groups[1].sessions.map((s) => s.id)).toEqual(["s1"]);
    expect(groups[2].sessions.map((s) => s.id)).toEqual(["s2"]);
  });

  it("keeps an empty label group but drops an empty default group", () => {
    const groups = buildGroups([session("s1", "l1")], [label("l1", 0), label("l2", 1)])!;
    expect(groups.map((g) => g.label?.id)).toEqual(["l1", "l2"]);
    expect(groups[1].sessions).toEqual([]);
  });

  it("treats a dangling labelId as unlabelled", () => {
    const groups = buildGroups([session("s1", "gone")], [label("l1", 0)])!;
    expect(groups[0].sessions).toEqual([]);
    expect(groups[1].label).toBeNull();
    expect(groups[1].sessions.map((s) => s.id)).toEqual(["s1"]);
  });

  it("preserves the incoming order inside a group", () => {
    const groups = buildGroups(
      [session("newest", "l1"), session("older", "l1"), session("oldest", "l1")],
      [label("l1", 0)],
    )!;
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["newest", "older", "oldest"]);
  });
});
