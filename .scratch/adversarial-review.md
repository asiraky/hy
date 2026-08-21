Found 3 concrete defects.

- [web/src/lib/paths.ts:89](/Users/aaron/code/hy/.worktrees/issue-71-inline-code-with-a-slash-e-g-system-init/web/src/lib/paths.ts:89) — Explicit extensionless paths are rejected. `detectPath("./scripts/build")` and absolute workspace paths such as `/Users/aaron/code/hy/bin/dev` return `null`. These are unambiguous paths—absolute workspace paths are explicitly supported by `openPath`—but the new rule discards the `./` signal and accepts only extensions, line anchors, or trailing slashes.

- [web/src/lib/paths.ts:89](/Users/aaron/code/hy/.worktrees/issue-71-inline-code-with-a-slash-e-g-system-init/web/src/lib/paths.ts:89) — Known extensionless filenames stop working inside directories. `docs/README`, `.github/CODEOWNERS`, and `/Users/aaron/code/hy/Makefile` all return `null`. The `BARE_FILES` allowlist at line 92 is never reached for slashed candidates, regressing filenames the detector intentionally supports.

- [web/src/lib/paths.ts:83](/Users/aaron/code/hy/.worktrees/issue-71-inline-code-with-a-slash-e-g-system-init/web/src/lib/paths.ts:83) — A dot in any segment is incorrectly treated as proof of a file path. `github.com/asiraky/hy`, `api.example.com/system/init`, and `foo.bar/turn/interrupt` still become clickable local-file chips. Thus the false-positive class remains whenever the protocol/method token is prefixed by a dotted namespace or scheme-less hostname.

The explicit `system/init`, `turn/interrupt`, and `rawMaxTokens/maxTokens` examples are fixed. I found no concrete defect in the chip-height CSS change.

`gh issue view 71 --comments` was run first but GitHub connectivity was blocked, so I could not independently verify the issue comments. Vitest and TypeScript compilation were also prevented by the read-only sandbox because they create cache/build-info files; I verified the parser scenarios directly with Node instead.