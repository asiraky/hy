/**
 * Reasoning levels travel as the harness's own ids — "xhigh", "max" — which is
 * what a command takes but not what a menu should say. Everything user-facing
 * goes through here, so the composer, the effort menu and the project defaults
 * all name a level the same way instead of each rendering the raw id.
 */
const EFFORT_LABELS: Record<string, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** The name for "no level named", which defers to the harness. */
export const AUTO_EFFORT_LABEL = "Auto";

/**
 * A level's display name. An id no one here has heard of is title-cased rather
 * than hidden: a harness that ships a new level should still read as a word.
 */
export function formatEffort(effort: string): string {
  if (!effort) return AUTO_EFFORT_LABEL;
  return EFFORT_LABELS[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1);
}
