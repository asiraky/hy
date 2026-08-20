import type { ModelMeta } from "~/protocol";

/**
 * One model as the picker deals with it: the model itself plus the provider
 * instance it belongs to. Search spans every instance, so a row has to carry
 * its own provenance rather than inheriting it from the rail's selection.
 */
export interface ModelRow {
  instance: string;
  instanceName: string;
  driver: string;
  model: ModelMeta;
}

/**
 * Scores one row against a query. Higher is better; 0 means no match.
 *
 * The fields searched are the ones a person types from memory: the model's
 * name, its id, its generation, and the account it lives under — so "codex"
 * finds models under an instance named "Codex Personal" even when the model
 * itself is called GPT-5.6-Sol. Matching is per token so "sol 5.6" and
 * "5.6 sol" both land, and every token has to match something.
 */
export function scoreModel(row: ModelRow, query: string): number {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;

  const fields = [
    { text: row.model.label, weight: 3 },
    { text: row.model.id, weight: 2.5 },
    { text: row.model.version ?? "", weight: 2 },
    { text: row.instanceName, weight: 1.5 },
    { text: row.driver, weight: 1.5 },
    { text: row.model.description ?? "", weight: 1 },
  ].map((f) => ({ ...f, text: f.text.toLowerCase() }));

  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of fields) {
      best = Math.max(best, matchScore(field.text, token) * field.weight);
    }
    // Every token must find a home: a query is a conjunction, so "sol haiku"
    // matching only "sol" would be a false positive.
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/** Ranks rows by score, keeping the given order among equal scores. */
export function rankModels<T extends ModelRow>(rows: T[], query: string): T[] {
  return rows
    .map((row, index) => ({ row, index, score: scoreModel(row, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.row);
}

function matchScore(text: string, token: string): number {
  if (!text) return 0;
  if (text === token) return 4;
  if (text.startsWith(token)) return 3;
  // A match at a word boundary ("codex-spark" for "spark") reads as
  // deliberate; one buried mid-word is weaker but still real.
  if (new RegExp(`\\b${escapeRegExp(token)}`).test(text)) return 2.5;
  if (text.includes(token)) return 2;
  // Fuzzy matching only past two characters: on one or two, everything
  // matches everything and the ranking stops meaning anything.
  if (token.length >= 3 && subsequence(text, token)) return 1;
  return 0;
}

/** True when every character of token appears in text, in order. */
function subsequence(text: string, token: string): boolean {
  let i = 0;
  for (const ch of text) {
    if (ch === token[i]) i++;
    if (i === token.length) return true;
  }
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
