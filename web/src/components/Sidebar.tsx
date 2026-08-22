import { CircleAlertIcon, FolderIcon, GitBranchIcon, PanelLeftIcon, PlusIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { ConnectionStatus } from "~/client";
import { HarnessBadge } from "~/components/HarnessBadge";
import { IconButton } from "~/components/IconButton";
import { StatusDot } from "~/components/StatusDot";
import { ThemeToggle } from "~/components/ThemeToggle";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { SessionMeta } from "~/protocol";
import { useIsDesktop } from "~/useMediaQuery";

const BUSY_PHASES = ["turn", "provisioning", "creating", "cleaning"];
const FAILED_PHASES = ["provision_failed", "cleanup_failed"];

// The server derives attention from the live projection, which knows about
// pending permissions and questions; phase alone does not. The phase sets
// above remain only as a fallback for a server that predates attention.
function working(s: SessionMeta) {
  return s.attention ? s.attention === "working" : BUSY_PHASES.includes(s.phase);
}
function needsInput(s: SessionMeta) {
  return s.attention === "needs_permission" || s.attention === "needs_answer";
}
function failed(s: SessionMeta) {
  return s.attention ? s.attention === "failed" : FAILED_PHASES.includes(s.phase);
}

function ago(ms: number) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const WIDTH_KEY = "hy.sidebarWidth";
const MIN_WIDTH = 208;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 288;

interface SidebarProps {
  sessions: SessionMeta[];
  activeId: string | null;
  status: ConnectionStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** removeWorktree is the user's answer to the dialog's checkbox, never inferred. */
  onDelete: (id: string, removeWorktree: boolean) => void;
  /** Opens the "how to reach this server" panel. */
  onShowAccess: () => void;
  // Supplied by the server via the adapter; the sidebar knows no harness names.
  accentOf: (harness: string) => string | undefined;
  projectName: (id?: string) => string | undefined;
  /** The project's own checkout, which is never a worktree hy may remove. */
  projectRoot: (id?: string) => string | undefined;
}

function SessionList({
  sessions,
  activeId,
  onSelect,
  onDelete,
  accentOf,
  projectName,
  projectRoot,
}: Pick<
  SidebarProps,
  "sessions" | "activeId" | "onSelect" | "onDelete" | "accentOf" | "projectName" | "projectRoot"
>) {
  // Deleting a session can take a checkout on disk with it, so a stray click
  // on the X must not be enough on its own — the row's X only opens this
  // confirmation, and the checkout only goes if it is asked for there.
  const [confirming, setConfirming] = useState<SessionMeta | null>(null);
  const [removeWorktree, setRemoveWorktree] = useState(false);
  const ask = (s: SessionMeta) => {
    // Defaulted on for a worktree hy provisioned, because that is what hy did
    // before and it is usually right; off for one it merely borrowed.
    setRemoveWorktree(s.workspaceMode === "managed");
    setConfirming(s);
  };

  const mode = confirming?.workspaceMode ?? "";
  // "The last session hy knows of" is a question the sidebar can already
  // answer: it holds every session's cwd. A closed session counts — it still
  // names that path, and hy still knows of it.
  const sharers = confirming
    ? sessions.filter((s) => s.id !== confirming.id && s.cwd === confirming.cwd)
    : [];
  // Only these two modes have a directory hy could remove. A local session is
  // the user's own checkout, and a session with no project has no lease at all
  // — offering a checkbox for either would be offering an action the server
  // will not perform. Nor does a managed session whose provisioning failed
  // before it got a directory: its cwd is still the project root, and the
  // server refuses to remove that whatever the dialog asked for.
  const hasWorktree =
    (mode === "managed" || mode === "borrowed") &&
    !!confirming?.cwd &&
    confirming.cwd !== projectRoot(confirming.projectId);
  const removable = hasWorktree && sharers.length === 0;

  if (sessions.length === 0) {
    return (
      <p className="text-muted-foreground px-3 py-10 text-center text-[13px]">
        No sessions yet.
        <br />
        <span className="text-[12px]">Start one to see it here.</span>
      </p>
    );
  }

  // The row carries two actions, so the selectable area is its own button
  // rather than a click handler on the container — a button cannot legally
  // nest inside another button. The delete X overlays the timestamp's corner
  // instead of owning a column of its own, so an un-hovered row has no
  // phantom right margin; on hover (desktop) the timestamp yields to the X.
  return (
    <>
      {sessions.map((s) => {
        const active = s.id === activeId;
        return (
          <div
            key={s.id}
            className={cn(
              "group relative mb-0.5 rounded-lg transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "hover:bg-sidebar-accent/60",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              aria-current={active ? "true" : undefined}
              className="focus-visible:ring-ring block w-full min-w-0 cursor-pointer rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2"
            >
              {/* Two matched lines: text on the left, a small mark on the
                  right — timestamp above, provider logo below. */}
              <span className="flex items-center gap-1.5 pr-8 md:pr-0">
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {s.title || "Untitled"}
                </span>
                {working(s) && (
                  <span
                    role="status"
                    aria-label="Working"
                    className="bg-primary size-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
                  />
                )}
                {needsInput(s) && (
                  <span
                    role="status"
                    aria-label="Waiting for your input"
                    className="bg-attention size-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
                  />
                )}
                {failed(s) && (
                  <CircleAlertIcon
                    aria-label="Needs attention"
                    className="text-destructive size-3 shrink-0"
                  />
                )}
                <span className="text-muted-foreground shrink-0 font-mono text-[10px] transition-opacity md:group-hover:opacity-0 md:group-focus-within:opacity-0">
                  {ago(s.updatedAt)}
                </span>
              </span>
              <span className="text-muted-foreground mt-1 flex min-w-0 items-center gap-1 font-mono text-[10px]">
                <FolderIcon aria-hidden className="size-3 shrink-0" />
                <span className="truncate">
                  {projectName(s.projectId) ?? s.cwd.split("/").slice(-2).join("/")}
                </span>
                {s.branch && (
                  <>
                    <GitBranchIcon aria-hidden className="ml-1 size-3 shrink-0" />
                    <span className="truncate">{s.branch}</span>
                  </>
                )}
                <span className="ml-auto flex shrink-0 items-center pl-1.5">
                  <HarnessBadge
                    harness={s.harness}
                    accent={accentOf(s.harness)}
                    className="size-3.5"
                  />
                </span>
              </span>
            </button>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete session ${s.title || "Untitled"}`}
                  onClick={() => ask(s)}
                  // Aligned to the provider logo's column below it: the logo
                  // (14px, full-bleed) is centred 17px from the row's edge,
                  // and the X's lucide glyph carries ~1.5px of optical padding
                  // inside its 16px box — right-px puts the visible strokes on
                  // that same centre line.
                  // The visible square stays 32px so it keeps that alignment
                  // at every size; `after` grows the hit area to 44px without
                  // moving anything, which a larger button could not do.
                  className="hover:text-destructive absolute top-0.5 right-px size-8 shrink-0 after:absolute after:-inset-1.5 after:content-[''] md:size-8 md:opacity-0 md:after:hidden md:group-hover:opacity-100 md:focus-visible:opacity-100"
                >
                  <XIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete session</TooltipContent>
            </Tooltip>
          </div>
        );
      })}

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{confirming?.title || "Untitled"}”?</DialogTitle>
            {/* Whatever else it says, it says plainly whether anything on disk
                is at risk. The old copy promised a worktree removal that a
                borrowed session never performed. */}
            <DialogDescription>
              {mode === "local"
                ? "This permanently deletes the session and its transcript. Your checkout is left untouched."
                : "This permanently deletes the session and its transcript."}
            </DialogDescription>
          </DialogHeader>

          {confirming && hasWorktree && (
            <div className="space-y-2 text-[12px]">
              {removable ? (
                <>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="delete-remove-worktree"
                      checked={removeWorktree}
                      onCheckedChange={(v) => setRemoveWorktree(v === true)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <Label htmlFor="delete-remove-worktree" className="cursor-pointer">
                        Also delete the worktree
                      </Label>
                      <span className="text-muted-foreground block font-mono text-[11px] break-all">
                        {confirming.cwd}
                      </span>
                    </div>
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    {confirming.branch
                      ? `The branch ${confirming.branch} is kept either way.`
                      : "Branches are never deleted."}
                    {mode === "borrowed" && " hy did not create this worktree."}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground text-[11px]">
                  The worktree is left on disk: {sharers.length} other session
                  {sharers.length === 1 ? "" : "s"} still
                  {sharers.length === 1 ? " uses" : " use"} it
                  {sharers[0]?.title ? ` (“${sharers[0].title}”)` : ""}.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirming) onDelete(confirming.id, removable && removeWorktree);
                setConfirming(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The panel itself, identical whether it is docked or in the mobile sheet.
 *
 * `showCollapse` is the one difference, and it is not a platform difference:
 * the collapse control is only offered when there is something behind the
 * panel to go back to. On a phone with no session selected there is nothing,
 * so the row is just the title and the one action.
 */
function SidebarPanel({ showCollapse, ...props }: SidebarProps & { showCollapse: boolean }) {
  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full min-h-0 flex-col">
      {/* One quiet header row: what the panel is, and the one action it
          offers. Branding and the status dot earn no space up here — the dot
          lives in the footer, still one click from the access panel. */}
      <div className="flex items-center gap-2 px-3 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-1.5">
        <span className="flex-1 px-1.5 font-mono text-sm font-semibold tracking-tight">hy</span>
        <IconButton label="New session" onClick={props.onNew} className="text-muted-foreground hover:text-foreground">
          <PlusIcon />
        </IconButton>
        {showCollapse && (
          <IconButton
            label="Hide sessions"
            onClick={() => props.onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <PanelLeftIcon />
          </IconButton>
        )}
      </div>

      <nav aria-label="Sessions" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <SessionList {...props} />
      </nav>

      <Separator />

      <div className="flex items-center gap-2 px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <span className="text-muted-foreground flex-1 text-[11px]">
          {props.sessions.length} session{props.sessions.length === 1 ? "" : "s"}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={props.onShowAccess}
              aria-label="How to reach this server"
              // The dot stays a dot; the target around it is thumb-sized on a
              // phone and shrinks to the dot again for a pointer.
              className="focus-visible:ring-ring flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 md:size-6"
            >
              <StatusDot status={props.status} />
            </button>
          </TooltipTrigger>
          <TooltipContent>How to reach this server</TooltipContent>
        </Tooltip>
        <ThemeToggle />
      </div>
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const isDesktop = useIsDesktop();

  // Below md the sidebar is a drawer over the transcript, which is a sheet's
  // whole job: overlay, focus trap, escape to close. At md it is the docked
  // panel again and collapses by margin, exactly as before — the breakpoint
  // here is the same one useMediaQuery and the CSS agree on.
  if (!isDesktop) {
    return (
      <Sheet open={props.open} onOpenChange={props.onOpenChange}>
        <SheetContent
          side="left"
          tabIndex={-1}
          // Full-bleed on a phone. A 15% sliver of dimmed transcript is not
          // context, it is a target for a mis-tap, and with no session
          // selected there is nothing behind the panel at all.
          // `sm:max-w-none` is not redundant: the sheet's own base classes cap
          // it at 24rem from `sm` up, which would leave a 384px panel on a
          // landscape phone — inside this branch, but past that breakpoint.
          className="w-screen max-w-none gap-0 border-r-0 p-0 pl-[env(safe-area-inset-left)] sm:max-w-none"
          // The sheet's own X would be a second close control in the same
          // corner as the collapse button, misaligned with it and present
          // even when there is nothing to close back to. One control, and it
          // lives in the panel header where the docked sidebar puts it.
          showCloseButton={false}
          // Radix otherwise focuses the first control inside, which pops its
          // tooltip open on a touch screen and leaves it there. Focus still
          // has to enter the panel — a modal that traps focus outside itself
          // is unusable with a keyboard or a screen reader — so it lands on
          // the panel rather than nowhere.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          <SheetTitle className="sr-only">Sessions</SheetTitle>
          {/* Nothing behind the panel means nothing to collapse to. */}
          <SidebarPanel {...props} showCollapse={props.activeId !== null} />
        </SheetContent>
      </Sheet>
    );
  }

  return <DockedSidebar {...props} />;
}

function DockedSidebar(props: SidebarProps) {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH
      ? stored
      : DEFAULT_WIDTH;
  });
  const dragging = useRef(false);
  // The drag handlers close over nothing but this ref, so the release handler
  // can persist the final width without reaching into React state.
  const widthRef = useRef(width);
  // Resizing must not animate: the margin transition exists for open/close,
  // and fighting the pointer with a 200ms lag makes the drag feel broken.
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    widthRef.current = width;
    if (!dragging.current) localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  const startDrag = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    setResizing(true);
    const onMove = (m: PointerEvent) => {
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, m.clientX));
      widthRef.current = w;
      setWidth(w);
    };
    const onUp = () => {
      dragging.current = false;
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      localStorage.setItem(WIDTH_KEY, String(widthRef.current));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  return (
    <aside
      // Collapsed it is off-screen but still in the document, so it is taken
      // out of the tab order rather than being a set of controls you can focus
      // but not see.
      inert={!props.open}
      style={{ width, marginLeft: props.open ? 0 : -width }}
      className={cn(
        "relative shrink-0 border-r",
        !resizing && "transition-[margin] duration-200 motion-reduce:transition-none",
      )}
    >
      <SidebarPanel {...props} showCollapse />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the sidebar"
        onPointerDown={startDrag}
        className="hover:bg-primary/40 absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize"
      />
    </aside>
  );
}
