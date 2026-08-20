import { describe, expect, it } from "vitest";

import { rankModels, scoreModel, type ModelRow } from "./modelSearch";
import type { ModelMeta } from "~/protocol";

function row(
  over: Omit<Partial<ModelRow>, "model"> & {
    label: string;
    id: string;
    model?: Partial<ModelMeta>;
  },
): ModelRow {
  return {
    instance: over.instance ?? "codex",
    instanceName: over.instanceName ?? "Codex",
    driver: over.driver ?? "codex",
    model: { id: over.id, label: over.label, ...over.model },
  };
}

const rows: ModelRow[] = [
  row({ id: "gpt-5.6-sol", label: "GPT-5.6-Sol", model: { version: "5.6" } }),
  row({ id: "gpt-5.4-mini", label: "GPT-5.4-Mini", model: { version: "5.4" } }),
  row({
    id: "haiku",
    label: "Haiku",
    instance: "claude",
    instanceName: "Claude Code",
    driver: "claude",
    model: { version: "Haiku 4.5", description: "Fastest for quick answers" },
  }),
];

describe("scoreModel", () => {
  it("ranks a name match above a description match", () => {
    const name = scoreModel(rows[2], "haiku");
    const description = scoreModel(rows[2], "quick");
    expect(name).toBeGreaterThan(description);
  });

  it("requires every token to match something", () => {
    expect(scoreModel(rows[0], "sol 5.6")).toBeGreaterThan(0);
    // "sol" matches, "haiku" does not: a query is a conjunction.
    expect(scoreModel(rows[0], "sol haiku")).toBe(0);
  });

  it("is order-independent across tokens", () => {
    expect(scoreModel(rows[0], "5.6 sol")).toBe(scoreModel(rows[0], "sol 5.6"));
  });

  it("matches the account a model lives under", () => {
    // Typing the account name is how you find its models when they are named
    // after something else entirely.
    expect(scoreModel(rows[2], "claude")).toBeGreaterThan(0);
    expect(scoreModel(rows[0], "claude")).toBe(0);
  });

  it("only fuzzy-matches past two characters", () => {
    // "gsl" is a subsequence of "gpt-5.6-sol"; "gl" would be a subsequence of
    // nearly everything, so short queries stay literal.
    expect(scoreModel(rows[0], "gsl")).toBeGreaterThan(0);
    expect(scoreModel(rows[0], "gl")).toBe(0);
  });

  it("matches everything on an empty query", () => {
    expect(scoreModel(rows[0], "  ")).toBeGreaterThan(0);
  });
});

describe("rankModels", () => {
  it("spans every account rather than the one being browsed", () => {
    const got = rankModels(rows, "5");
    expect(got.map((r) => r.instance)).toContain("claude");
  });

  it("puts the closest match first and drops the rest", () => {
    const got = rankModels(rows, "mini");
    expect(got.map((r) => r.model.id)).toEqual(["gpt-5.4-mini"]);
  });

  it("keeps the given order among equally good matches", () => {
    const got = rankModels(rows, "gpt");
    expect(got.map((r) => r.model.id)).toEqual(["gpt-5.6-sol", "gpt-5.4-mini"]);
  });
});
