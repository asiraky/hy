import type { ComposerItem } from "~/protocol";

export interface ComposerTrigger {
  trigger: string;
  query: string;
  start: number;
  end: number;
}

export function detectComposerTrigger(
  text: string,
  cursor: number,
  items: ComposerItem[],
): ComposerTrigger | null {
  const safeCursor = Math.max(0, Math.min(text.length, cursor));
  const triggers = [...new Set(items.map((item) => item.trigger).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const lineStart = text.lastIndexOf("\n", Math.max(0, safeCursor - 1)) + 1;
  const line = text.slice(lineStart, safeCursor);
  let tokenEnd = safeCursor;
  while (tokenEnd < text.length && !/\s/.test(text[tokenEnd] ?? "")) tokenEnd++;
  for (const trigger of triggers) {
    if (trigger === "/") {
      if (!line.startsWith(trigger) || /\s/.test(line)) continue;
      return { trigger, query: line.slice(trigger.length), start: lineStart, end: tokenEnd };
    }
  }

  let tokenStart = safeCursor;
  while (tokenStart > 0 && !/\s/.test(text[tokenStart - 1] ?? "")) tokenStart--;
  const token = text.slice(tokenStart, safeCursor);
  for (const trigger of triggers) {
    if (trigger === "/" || !token.startsWith(trigger)) continue;
    return { trigger, query: token.slice(trigger.length), start: tokenStart, end: tokenEnd };
  }
  return null;
}

export function rankComposerItems(items: ComposerItem[], trigger: ComposerTrigger): ComposerItem[] {
  return items
    .filter((item) => item.trigger === trigger.trigger)
    .map((item, index) => ({ item, index, score: scoreItem(item, trigger.query) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.item);
}

function scoreItem(item: ComposerItem, rawQuery: string): number {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return 1;
  const names = [item.name, ...(item.aliases ?? [])].map((value) => value.toLowerCase());
  let best = 0;
  for (const name of names) best = Math.max(best, matchScore(name, query) * 4);
  best = Math.max(best, matchScore(item.description?.toLowerCase() ?? "", query) * 1.5);
  best = Math.max(best, matchScore(item.argsHint?.toLowerCase() ?? "", query));
  return best;
}

function matchScore(text: string, query: string): number {
  if (!text) return 0;
  if (text === query) return 4;
  if (text.startsWith(query)) return 3;
  if (text.includes(query)) return 2;
  if (query.length < 3) return 0;
  let at = 0;
  for (const char of text) {
    if (char === query[at]) at++;
    if (at === query.length) return 1;
  }
  return 0;
}

export function replaceComposerTrigger(text: string, trigger: ComposerTrigger, replacement: string) {
  const value = `${text.slice(0, trigger.start)}${replacement}${text.slice(trigger.end)}`;
  return { value, cursor: trigger.start + replacement.length };
}

/** Match a submitted standalone action and return its unparsed argument tail. */
export function submittedComposerAction(text: string, items: ComposerItem[]) {
  const trimmed = text.trim();
  for (const item of items) {
    if (item.behavior === "prompt") continue;
    if (trimmed === item.insertText) return { item, args: "" };
    if (trimmed.startsWith(item.insertText + " ")) {
      return { item, args: trimmed.slice(item.insertText.length).trim() };
    }
  }
  return null;
}
