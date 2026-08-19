import type { SessionMeta } from "../protocol";
import { Button, HarnessBadge, StatusDot } from "./ui";
import { cx } from "../cx";
import type { ConnectionStatus } from "../client";

function ago(ms: number) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function Sidebar({
  sessions,
  activeId,
  status,
  open,
  onSelect,
  onNew,
  onDelete,
  accentOf,
  projectName,
}: {
  sessions: SessionMeta[];
  activeId: string | null;
  status: ConnectionStatus;
  open: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  // Supplied by the server via the adapter; the sidebar knows no harness names.
  accentOf: (harness: string) => string | undefined;
  projectName: (id?: string) => string | undefined;
}) {
  return (
    <aside
      className={cx(
        // Below md the sidebar is a drawer over the transcript: fixed, opaque,
        // and slid out of frame when closed. At md it becomes the inline panel
        // again and collapses by margin, exactly as before.
        "fixed inset-y-0 left-0 z-40 flex w-[min(20rem,85vw)] flex-col border-r border-ink-800",
        "bg-ink-900 pl-[env(safe-area-inset-left)] transition-[transform,margin] duration-200",
        "md:static md:z-auto md:w-72 md:shrink-0 md:bg-ink-900/50 md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full",
        !open && "md:-ml-72",
      )}
    >
      <div className="flex items-center gap-2 px-4 pt-[calc(0.875rem+env(safe-area-inset-top))] pb-3.5">
        <span className="font-mono text-sm font-semibold tracking-tight">hy</span>
        <span className="flex-1 text-[11px] text-ink-500">harness multiplexer</span>
        <StatusDot status={status} />
      </div>

      <div className="px-3 pb-3">
        <Button variant="primary" className="w-full justify-center" onClick={onNew}>
          New session
        </Button>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
        {sessions.length === 0 && (
          <p className="px-2 py-6 text-center text-[13px] text-ink-500">No sessions yet.</p>
        )}

        {/* The row carries two actions, so the selectable area is its own
            button rather than a click handler on the container — a button
            cannot legally nest inside another button. */}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={cx(
              "group mb-0.5 flex items-start gap-2 rounded-lg px-2.5 py-2 transition",
              s.id === activeId ? "bg-ink-800" : "hover:bg-ink-850",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              aria-current={s.id === activeId ? "true" : undefined}
              className="min-w-0 flex-1 cursor-pointer text-left"
            >
              <span className="flex items-center gap-1.5">
                <HarnessBadge harness={s.harness} accent={accentOf(s.harness)} />
                {["turn","provisioning","creating","cleaning"].includes(s.phase) && (
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
                )}
                {["provision_failed","cleanup_failed"].includes(s.phase) && <span className="size-1.5 shrink-0 rounded-full bg-red-400" />}
                <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-500">
                  {ago(s.updatedAt)}
                </span>
              </span>
              <span className="mt-1 block truncate text-[13px] text-ink-100">
                {s.title || "Untitled"}
              </span>
              <span className="block truncate font-mono text-[10px] text-ink-500">
                {projectName(s.projectId) ?? s.cwd.split("/").slice(-2).join("/")}{s.branch ? ` · ${s.branch}` : ""}
              </span>
            </button>

            <button
              type="button"
              aria-label={`Delete session ${s.title || "Untitled"}`}
              onClick={() => onDelete(s.id)}
              className="-mr-1 flex size-11 shrink-0 items-center justify-center rounded text-ink-500 transition hover:text-red-400 md:size-8 md:opacity-0 md:group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
