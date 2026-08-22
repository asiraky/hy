/**
 * Folding the flat session list into the user's label groups.
 *
 * Pure on purpose, like buildRows: the sidebar hands in whatever list it is
 * currently rendering — including the delete flow's frozen ordering — and gets
 * groups back, so grouping composes with the exit animation instead of
 * fighting it.
 *
 * The rules, from the issue:
 * - One group per label, in the user's chosen order, whether or not it holds
 *   any sessions: an empty group is still the user's structure.
 * - Unlabelled sessions fall into a single default group at the end. A session
 *   pointing at a label that no longer exists counts as unlabelled — the
 *   assignment broadcast can land a beat after the deletion broadcast.
 * - Within a group the incoming order holds (updated_at DESC upstream).
 * - With zero labels defined there are no groups at all: the caller renders
 *   the flat list exactly as it always has.
 */

import type { Label, SessionMeta } from "~/protocol";

export interface SessionGroup {
  /** Null for the default group holding unlabelled sessions. */
  label: Label | null;
  sessions: SessionMeta[];
}

export function buildGroups(sessions: SessionMeta[], labels: Label[]): SessionGroup[] | null {
  if (labels.length === 0) return null;

  const byLabel = new Map<string, SessionMeta[]>(labels.map((l) => [l.id, []]));
  const unlabelled: SessionMeta[] = [];
  for (const s of sessions) {
    const bucket = s.labelId ? byLabel.get(s.labelId) : undefined;
    if (bucket) bucket.push(s);
    else unlabelled.push(s);
  }

  const groups: SessionGroup[] = labels.map((label) => ({
    label,
    sessions: byLabel.get(label.id)!,
  }));
  // The default group earns its header only by holding something; an empty
  // "everything else" bucket is noise, not structure.
  if (unlabelled.length > 0) groups.push({ label: null, sessions: unlabelled });
  return groups;
}
