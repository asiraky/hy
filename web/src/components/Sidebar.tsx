import { CircleAlertIcon, FolderIcon, GitBranchIcon, PanelLeftIcon, PlusIcon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

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
import { Spinner } from "~/components/ui/spinner";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { SessionMeta } from "~/protocol";
import { useIsDesktop } from "~/useMediaQuery";

const BUSY_PHASES = ["turn", "provisioning", "creating", "cleaning"];
// How long a row takes to fold away once it has left the list. Kept in step
// with the duration on the row itself.
const EXIT_MS = 260;
const FAILED_PHASES = ["provision_failed", "cleanup_failed"];

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
  /**
   * removeWorktree is the user's answer to the dialog's checkbox, never
   * inferred. The promise, if one is returned, only says the request was
   * accepted — the delete is finished when the session leaves `sessions`.
   */
  onDelete: (id: string, removeWorktree: boolean) => void | Promise<unknown>;
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
  // A delete is not instant — the server tears the workspace down first, and
  // the row only leaves the list when that finishes. Three pieces of state
  // carry the wait:
  //
  // `deleting` keeps the dialog open, and honest, while the work runs.
  // `frozen` pins the list to the order it had when Delete was pressed: the
  //   server stamps the session as it enters "cleaning" and the list is
  //   ordered by that stamp, so without this the row shoots to the top and
  //   sits there until it vanishes.
  // `exiting` keeps the row on screen, in its own place, for one last
  //   animation after it has already left the list.
  const [deleting, setDeleting] = useState<SessionMeta | null>(null);
  const [frozen, setFrozen] = useState<string[] | null>(null);
  const [exiting, setExiting] = useState<SessionMeta | null>(null);
  // The delete this component is currently living through, for the one thing
  // that arrives too late to read state: a refusal from the server.
  const latest = useRef<string | null>(null);
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

  // Handing the row off to its exit animation is done here, during the render
  // that drops it, rather than in an effect: an effect would let one commit
  // through with the row already gone, and the DOM node we want to animate
  // would be destroyed before it could move.
  if (deleting && !sessions.some((s) => s.id === deleting.id)) {
    setDeleting(null);
    // Only the dialog that was asking about *this* session; the user may have
    // dismissed it and opened another meanwhile.
    setConfirming((c) => (c?.id === deleting.id ? null : c));
    setExiting(deleting);
  }

  // Teardown failed, so the row is staying. App is already asking what to do
  // about it; the dialog stops spinning and gets out of the way.
  const failed =
    deleting && sessions.some((s) => s.id === deleting.id && s.phase === "cleanup_failed")
      ? deleting.id
      : null;
  useEffect(() => {
    if (!failed) return;
    setDeleting(null);
    setConfirming((c) => (c?.id === failed ? null : c));
    setFrozen(null);
  }, [failed]);

  // The animation is the only thing still holding either of these.
  useEffect(() => {
    if (!exiting) return;
    const t = setTimeout(() => {
      setExiting(null);
      setFrozen(null);
    }, EXIT_MS + 60);
    return () => clearTimeout(t);
  }, [exiting]);

  // While a delete is in flight the sidebar renders the order it had when the
  // user committed to it, with the departing row put back at its own index.
  const rows = useMemo(() => {
    if (!frozen) return sessions;
    const rank = new Map(frozen.map((id, i) => [id, i]));
    // Anything the server has added since sorts ahead, which is where a new
    // session belongs in a most-recent-first list anyway.
    const list = [...sessions].sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
    if (exiting && !sessions.some((s) => s.id === exiting.id)) {
      const at = frozen.indexOf(exiting.id);
      if (at >= 0) list.splice(Math.min(at, list.length), 0, exiting);
    }
    return list;
  }, [sessions, frozen, exiting]);

  // The dialog is only "busy" for the session it is currently asking about: it
  // can be dismissed mid-delete and reopened on another row, and that row's
  // Delete button must still be a live button.
  const busy = !!deleting && deleting.id === confirming?.id;

  const startDelete = () => {
    if (!confirming || busy) return;
    const target = confirming;
    latest.current = target.id;
    setFrozen(sessions.map((s) => s.id));
    setExiting(null);
    setDeleting(target);
    Promise.resolve(onDelete(target.id, removable && removeWorktree)).catch(() => {
      // The failure has already been reported where it was raised; all that is
      // left here is to stop claiming the delete is still happening. Written
      // against the current state, not the state at the click: a slow refusal
      // must not clear a delete the user has since started on another row.
      if (latest.current !== target.id) return;
      setDeleting(null);
      setFrozen(null);
      setConfirming((c) => (c?.id === target.id ? null : c));
    });
  };

  if (rows.length === 0) {
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
      {rows.map((s) => {
        const active = s.id === activeId;
        const leaving = exiting?.id === s.id;
        const going = deleting?.id === s.id;
        return (
          // The row leaves from wherever it stands: it fades and slides out
          // while its own height folds shut under it, so the rows below close
          // the gap in the same motion instead of snapping up. The height is
          // the `1fr`→`0fr` grid track, which is the one way to transition to
          // a content-sized height the row never had to declare.
          <div
            key={s.id}
            inert={leaving}
            className={cn(
              "grid transition-[grid-template-rows,opacity,transform,margin] duration-[260ms] ease-out motion-reduce:transition-none",
              leaving
                ? "mb-0 grid-rows-[0fr] -translate-x-2 scale-[0.98] opacity-0"
                : "mb-0.5 grid-rows-[1fr]",
            )}
          >
            <div
              className={cn(
                "group relative rounded-lg transition-colors",
                leaving && "overflow-hidden",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/60",
                // Already on its way out: it shows what it is doing (the busy
                // dot below) but no longer takes clicks.
                going && "pointer-events-none opacity-60",
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
                  {BUSY_PHASES.includes(s.phase) && (
                    <span
                      role="status"
                      aria-label="Working"
                      className="bg-primary size-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
                    />
                  )}
                  {FAILED_PHASES.includes(s.phase) && (
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
          </div>
        );
      })}

      {/* It stays put while the delete runs: closing it on the click would be
          claiming the session is gone at the moment the work starts. It is
          still dismissable, though — a teardown script that hangs must not
          take the window with it. Dismissing only hides the progress; the
          delete carries on and the row still leaves on its own. */}
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
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={startDelete} disabled={busy}>
              {busy ? (
                <>
                  <Spinner aria-hidden className="size-4" />
                  {/* Named, because tearing a worktree down is the slow part
                      and the one worth waiting through. */}
                  {removable && removeWorktree ? "Deleting worktree…" : "Deleting…"}
                </>
              ) : (
                "Delete"
              )}
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
