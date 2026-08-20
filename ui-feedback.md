# Surfix UI Feedback — Running List

Collected 2026-08-20. **All 11 items implemented 2026-08-20** (worktree `feature-ui-updates`, uncommitted).
Theme sample page: open the app at `#themes`.

## 1. Resizable left sidebar
The left-hand sidebar needs to be resizable (drag to resize).

## 2. Sidebar colour / theme explorer
- Current sidebar colour doesn't match the colour scheme.
- Build a **theme sample page**: a fake/static version of the existing dashboard page with a floating menu or slider across the top to click through different colour schemes for comparison.
- **Chosen 2026-08-20: "Deep slate / raised"** (slate-blue hue 265, indigo accent 275, sidebar one step lighter than the canvas) — applied as the dark theme in `index.css`; light theme's accent hue aligned to the same indigo.

## 3. Remove SEQ indicator
- Remove the green-dot "SEQ" (sequence number) indicator in the top-right corner.
- ~~Replace with a context indicator in the top corner~~ — **revised**: the context indicator will NOT live in the top corner; it goes in the chat input instead (see item 7).

## 4. Diff window full-expand
- The diff window needs a one-click **full expand** button that takes it to the full content-panel width so the whole diff is visible.
- No in-between half-screen state — just the single full-open button.

## 5. Provider logos instead of badges
- Replace all Claude / ChatGPT / OpenAI text badges across the site with the actual provider logos we have.
- Implement as a reusable map/component (provider → logo) since it's used in multiple places.

## 6. Floating chat input (Claude.ai style)
- Replace the fixed bottom tray (with its full-width line/border) with a **floating input**.
- On first opening a session it floats at the bottom.
- The input contains the **model picker**; for an active session you can probably only change the model or the effort level.
- Visual reference: the Claude.ai chat input (screenshot reviewed 2026-08-20):
  - Rounded floating container (large border-radius, subtle border, no full-width tray line), padding around it, floats above the page bottom.
  - Multi-line text area with placeholder ("Write a message…") at the top of the container.
  - Bottom row *inside* the container: **+** (attach) button on the left; on the right, **model picker + effort level** as inline text ("Opus 5 Medium ⌄") with a chevron dropdown.
  - (Claude.ai also has mic/voice icons on the right — not needed for us.)
  - Small muted caption text centered below the input in Claude.ai — optional/not required.

## 7. Context indicator in chat input
- The context-usage indicator lives **in the chat input** (this is the only location — see item 3 revision).
- Subtle, colour-coded: green → yellow → red depending on context window usage.
- Show how much is used as a **percentage plus tokens out of total** — e.g. "10% — 10k / 100k tokens". The total must scale with the active model's context window. **Done 2026-08-20.**

## 8. Top nav fade instead of border
- The top bar's hard border is bad.
- Content scrolling up behind the top nav should **fade into it** (gradient fade) rather than disappear behind a hard line.

## 9. Agent message timestamps + copy
- Each message received from agents should show the **time received**.
- Possibly also a **copy** (copy-paste) button per message.

## 10. Remove tokens/price stats from top bar
- The top bar currently shows tokens in/out counts and a price — remove all of that from the top bar.

## 11. Hide permissions control in top bar
- The permissions thing at the top also goes — no changing permissions mid-chat for now.
- **Hide, don't delete**: keep the code/feature intact, just hide the UI so users don't try to use it. (No strong reason for it yet; may come back later.)

## 12. Declutter top nav — **done 2026-08-20**
- The top nav is too crowded: title + project directory + model is too much.
- **Remove the model** from the top nav — it's already shown in the chat input (item 6).
- **Remove the giant "main checkout" badge** — alerting that you're on the main checkout up there is wrong; it just adds clutter.
- **Remove the harness (Claude) icon and the project path** from the header too — just the session title is sufficient.

## 13. Sidebar session-item polish — **done 2026-08-20**
- More icons in the sidebar item: a folder icon next to the project/directory, a Git branch icon next to the branch.
- The delete X no longer owns its own column (which read as a weird right margin when not hovering); it overlays the row's top-right corner and swaps in over the timestamp on hover.
- Clicking the X now asks **"Are you sure?"** (confirmation dialog) before deleting, since it tears down the worktree — message adapts for main-checkout sessions.
- Provider icon moved to the **bottom-right corner** of the session item (was top-left).
- Sidebar header redesigned: removed the "hy · harness multiplexer" branding line, the status dot up top, and the giant **New session** button. Now one quiet header row — "SESSIONS" label + subtle **+** icon button. Status dot moved to the footer next to the theme toggle.
- Collapse-sidebar control moved **into** the sidebar header (right edge); the button in the main top nav now only appears when the sidebar is closed, to reopen it.

## 14. Changed-files card collapsed by default — **done 2026-08-20**
- The "files changed" card in the chat no longer auto-expands for small diffs; every card starts collapsed (summary line + preview chips on the newest turn) until clicked.
