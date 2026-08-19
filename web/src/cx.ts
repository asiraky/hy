/**
 * Joins class names, dropping anything falsy.
 *
 * Lives outside the component modules so that a file exporting components
 * exports only components — Fast Refresh cannot preserve component state in a
 * module that also exports plain values.
 */
export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
