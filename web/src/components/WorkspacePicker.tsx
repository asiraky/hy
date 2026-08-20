import { ChevronsUpDownIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import type { Issue, UserConfig, Workspace } from "~/protocol";

export interface WorkspaceChoice {
  /** What the user typed: the branch to create. Empty means "use the project default". */
  branch: string;
  /** Set only when attaching to a checkout that already exists. */
  attachPath: string;
}

/**
 * Turn the user's format function into a callable. It is their own code from
 * their own settings file, evaluated in their own browser, so `new Function` is
 * no wider a door than the settings box already is — but a typo in it must not
 * take the dialog down, hence the two layers of try/catch.
 */
export function makeFormatter(source: string): {
  format: (issue: Issue) => string;
  error: string | null;
} {
  const fallback = { format: (i: Issue) => `issue/${i.number}`, error: null as string | null };
  if (!source.trim()) return fallback;
  let fn: (issue: Issue) => unknown;
  try {
    fn = new Function("issue", `"use strict"; return (${source})(issue);`) as (
      issue: Issue,
    ) => unknown;
  } catch (e) {
    return { ...fallback, error: e instanceof Error ? e.message : String(e) };
  }
  return {
    error: null,
    format: (issue: Issue) => {
      try {
        const out = fn(issue);
        return typeof out === "string" ? out : String(out ?? "");
      } catch {
        return "";
      }
    },
  };
}

type Row =
  | { kind: "create"; branch: string }
  | { kind: "issue"; branch: string; issue: Issue }
  | { kind: "existing"; workspace: Workspace };

const rowKey = (r: Row) =>
  r.kind === "existing" ? `w:${r.workspace.path}` : r.kind === "issue" ? `i:${r.issue.number}` : "create";
const label = (w: Workspace) =>
  w.branch || (w.head ? `detached @ ${w.head}` : w.path.split("/").pop() || w.path);

/**
 * One control for both halves of the question. Typing names a worktree to
 * create — the common case, and the default with zero extra clicks. Opening the
 * list attaches to one that already exists.
 */
export function WorkspacePicker({
  id,
  value,
  onChange,
  workspaces,
  issues,
  issuesError,
  userConfig,
  loading,
  placeholder,
}: {
  id?: string;
  value: WorkspaceChoice;
  onChange: (v: WorkspaceChoice) => void;
  workspaces: Workspace[];
  issues: Issue[];
  issuesError: string;
  userConfig: UserConfig | null;
  loading: boolean;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  const attached = value.attachPath
    ? workspaces.find((w) => w.path === value.attachPath)
    : undefined;
  const text = attached ? label(attached) : value.branch;

  const formatter = useMemo(
    () => makeFormatter(userConfig?.branchFormat ?? ""),
    [userConfig?.branchFormat],
  );

  const rows = useMemo<Row[]>(() => {
    const typed = value.attachPath ? "" : value.branch.trim();
    const needle = typed.toLowerCase();
    const out: Row[] = [];
    if (typed) out.push({ kind: "create", branch: typed });
    if (userConfig?.suggestIssues !== false) {
      for (const issue of issues) {
        const branch = formatter.format(issue);
        if (!branch || branch === typed) continue;
        if (
          needle &&
          !branch.toLowerCase().includes(needle) &&
          !issue.title.toLowerCase().includes(needle)
        )
          continue;
        out.push({ kind: "issue", branch, issue });
      }
    }
    for (const w of workspaces) {
      if (needle && !label(w).toLowerCase().includes(needle) && !w.path.toLowerCase().includes(needle))
        continue;
      out.push({ kind: "existing", workspace: w });
    }
    return out;
  }, [value.branch, value.attachPath, issues, workspaces, formatter, userConfig?.suggestIssues]);

  const selectable = (r: Row) => !(r.kind === "existing" && r.workspace.busy);
  useEffect(() => {
    setActive(0);
  }, [rows.length]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const choose = (r: Row) => {
    if (!selectable(r)) return;
    if (r.kind === "existing") onChange({ branch: "", attachPath: r.workspace.path });
    else onChange({ branch: r.branch, attachPath: "" });
    setOpen(false);
  };

  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      for (let i = 1; i <= rows.length; i++) {
        const next = (active + step * i + rows.length * i) % rows.length;
        if (selectable(rows[next])) {
          setActive(next);
          return;
        }
      }
      return;
    }
    // Enter picks the highlighted row only while the list is open; otherwise it
    // falls through to the dialog, where it starts the session.
    if (e.key === "Enter" && open && rows[active]) {
      e.preventDefault();
      choose(rows[active]);
    }
  };

  const group = (title: string) => (
    <div
      key={`h:${title}`}
      role="presentation"
      className="text-muted-foreground px-3 pt-2 pb-1 text-[10px] tracking-wide uppercase"
    >
      {title}
    </div>
  );
  const body: React.ReactNode[] = [];
  let last = "";
  rows.forEach((r, i) => {
    const heading =
      r.kind === "existing"
        ? "Existing worktrees"
        : r.kind === "issue"
          ? "From open issues"
          : "Create new worktree";
    if (heading !== last) {
      body.push(group(heading));
      last = heading;
    }
    const busy = r.kind === "existing" && r.workspace.busy;
    body.push(
      <button
        key={rowKey(r)}
        id={`${listId}-${i}`}
        role="option"
        aria-selected={i === active}
        type="button"
        disabled={busy}
        onMouseEnter={() => setActive(i)}
        onClick={() => choose(r)}
        className={cn(
          "flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[12px]",
          i === active && !busy && "bg-accent text-accent-foreground",
          busy && "opacity-40",
        )}
      >
        <span className="font-mono">{r.kind === "existing" ? label(r.workspace) : r.branch}</span>
        {r.kind === "issue" && (
          <span className="text-muted-foreground min-w-0 flex-1 truncate">
            #{r.issue.number} {r.issue.title}
          </span>
        )}
        {r.kind === "existing" && r.workspace.isRoot && (
          <span className="text-muted-foreground">project root</span>
        )}
        {busy && <span className="text-attention-foreground ml-auto shrink-0">in use</span>}
        {r.kind === "existing" && r.workspace.locked && !busy && (
          <span className="text-muted-foreground ml-auto shrink-0">locked</span>
        )}
      </button>,
    );
  });

  return (
    <div ref={box} className="relative">
      <div className="flex gap-2">
        <Input
          id={id}
          value={text}
          onKeyDown={key}
          onFocus={() => setOpen(true)}
          onChange={(e) => onChange({ branch: e.target.value, attachPath: "" })}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
          className="min-w-0 flex-1 font-mono text-[12px]"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={open ? "Hide worktrees" : "Show worktrees"}
          onClick={() => setOpen(!open)}
        >
          <ChevronsUpDownIcon />
        </Button>
      </div>

      <p className="text-muted-foreground mt-1.5 text-[11px]">
        {attached
          ? `Attaching to ${attached.path}`
          : value.branch.trim()
            ? "Creates a new worktree on this branch."
            : "Leave empty to use the project default."}
      </p>

      {open && (
        <div
          id={listId}
          role="listbox"
          className="scroll-thin bg-popover text-popover-foreground absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border py-1 shadow-md"
        >
          {loading && (
            <p className="text-muted-foreground px-3 py-2 text-[12px]">Loading worktrees…</p>
          )}
          {!loading && rows.length === 0 && (
            <p className="text-muted-foreground px-3 py-2 text-[12px]">
              Type a branch name to create a worktree.
            </p>
          )}
          {body}
          {formatter.error && (
            <p className="text-attention-foreground px-3 py-2 text-[11px]">
              Branch format function: {formatter.error}
            </p>
          )}
          {issuesError && !formatter.error && (
            <p className="text-muted-foreground px-3 py-2 text-[11px]">
              No issue suggestions: {issuesError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
