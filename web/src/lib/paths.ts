// Deciding whether a span of inline code is a file path. Only inline code is
// considered — agents backtick paths nearly always, and walking arbitrary
// prose would misfire constantly. The defenses here are borrowed from t3code:
// a TLD denylist so `example.com` is not a path, an extensionless allowlist so
// `Makefile` is, and a rule that a candidate must have a path prefix, an
// extension, or a `:line` suffix to count at all.

export interface DetectedPath {
  /** The path as written, minus any leading ./ and any :line:col anchor. */
  path: string;
  line?: number;
}

// Hosts' most common TLDs. A dot-separated candidate whose last segment is one
// of these, with no slash and no line anchor, is a domain being mentioned, not
// a file.
const TLDS = new Set([
  "com", "org", "net", "io", "dev", "app", "ai", "co", "edu", "gov", "info",
  "biz", "xyz", "me", "tv", "sh", "gg", "au", "uk", "de", "fr", "jp", "nz",
]);

// Extensionless names that are files anyway.
const BARE_FILES = new Set([
  "makefile", "dockerfile", "rakefile", "gemfile", "justfile", "procfile",
  "readme", "license", "codeowners", "changelog", "contributing", "authors",
]);

// Everything a path may be made of. Spaces, backticks and most punctuation
// exclude a candidate outright.
const SHAPE = /^[A-Za-z0-9_\-./@+~]+$/;

/**
 * Decide whether one inline-code span is a file path, and split off any
 * `:line` / `:line:col` anchor. Returns null for anything that does not look
 * strongly enough like a path to be worth a chip.
 */
export function detectPath(raw: string): DetectedPath | null {
  let text = raw.trim();
  if (text.length < 2 || text.length > 260) return null;
  if (text.includes("://") || text.startsWith("www.")) return null;

  // Split a trailing :12 or :12:5 anchor before judging the rest.
  let line: number | undefined;
  const anchor = /:(\d+)(?::\d+)?$/.exec(text);
  if (anchor) {
    line = Number(anchor[1]);
    text = text.slice(0, anchor.index);
  }

  if (!SHAPE.test(text)) return null;
  if (text.startsWith("./")) text = text.slice(2);
  if (text === "" || text === "." || text === "..") return null;
  // A parent-relative path points outside anything we can open.
  if (text.startsWith("../") || text.includes("/../")) return null;
  // Flag-looking spans (`--no-color`) and lone dotfiles of punctuation.
  if (text.startsWith("-")) return null;

  // A single trailing slash (`web/`, `web/src/`) is an explicit directory
  // reference — a strong path signal even without an extension.
  const trailingSlash = text.endsWith("/");
  if (trailingSlash) text = text.slice(0, -1);
  if (text === "") return null;
  const hasSlash = text.includes("/");
  const base = hasSlash ? text.slice(text.lastIndexOf("/") + 1) : text;
  if (base === "") return null;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";

  // A domain: dotted, slashless, anchorless, ending in a TLD.
  if (!hasSlash && line === undefined && ext !== "" && TLDS.has(ext)) return null;

  // The admission rule: a path prefix, or an extension, or a line anchor, or a
  // known bare filename. A bare word (`filter`, `main`) is none of these.
  if (hasSlash) {
    // All-numeric segments are a date or a fraction (`1/2/2024`), not a path.
    const segments = text.split("/").filter(Boolean);
    if (segments.every((s) => /^\d+$/.test(s))) return null;
    // A slash alone is too weak: `system/init`, `turn/interrupt` and `a/b`
    // alternatives (`rawMaxTokens/maxTokens`) are protocol/method names, not
    // files. Admit only with a corroborating signal — a plausible file
    // extension on some segment, a `:line` anchor, or an explicit trailing
    // slash marking a directory (`web/src/`).
    const hasExt = segments.some((s) => {
      const d = s.lastIndexOf(".");
      if (d <= 0) return false;
      const e = s.slice(d + 1).toLowerCase();
      return /^[a-z0-9]{1,10}$/.test(e) && !/^\d+$/.test(e);
    });
    if (!hasExt && line === undefined && !trailingSlash) return null;
    return { path: text, line };
  }
  if (BARE_FILES.has(base.toLowerCase()) || BARE_FILES.has(base.toLowerCase().replace(/\.(md|txt|rst)$/, ""))) {
    return { path: text, line };
  }
  if (ext !== "" && /^[a-z0-9]{1,10}$/.test(ext) && !/^\d+$/.test(ext)) {
    return { path: text, line };
  }
  if (line !== undefined && dot > 0) {
    return { path: text, line };
  }
  return null;
}
