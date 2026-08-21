Found 1 real defect.

- `web/src/components/NewSession.tsx:55, 480-498` — `BASE_DEFAULT` is `"__default__"`, also a valid Git branch name. If that branch is checked out while the project default differs, the dropdown contains two options with the same value. Selecting the real branch is interpreted as “Project default,” so `baseRef` becomes empty and the worktree starts from the wrong commit.

The diff otherwise matches the three requirements recorded in the commit: trim Main-checkout copy, fold scratch into a blank branch name, and use a Base dropdown.

`gh issue view 55 --comments` could not reach GitHub, and the public web fallback returned no issue content, so direct comparison with the issue comments was unavailable. The independent reviewer found the same single defect.

`git diff --check` passed. Tests and TypeScript compilation could not run because the read-only sandbox prevented creation of Vite and TypeScript temporary files.