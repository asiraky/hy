import { CircleAlertIcon, PlusIcon, XIcon } from "lucide-react";

import type { ConnectionStatus } from "~/client";
import { HarnessBadge } from "~/components/HarnessBadge";
import { StatusDot } from "~/components/StatusDot";
import { ThemeToggle } from "~/components/ThemeToggle";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { SessionMeta } from "~/protocol";
import { useIsDesktop } from "~/useMediaQuery";

const BUSY_PHASES = ["turn", "provisioning", "creating", "cleaning"];
const FAILED_PHASES = ["provision_failed", "cleanup_failed"];

function ago(ms: number) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

interface SidebarProps {
  sessions: SessionMeta[];
  activeId: string | null;
  status: ConnectionStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  // Supplied by the server via the adapter; the sidebar knows no harness names.
  accentOf: (harness: string) => string | undefined;
  projectName: (id?: string) => string | undefined;
}

function SessionList({
  sessions,
  activeId,
  onSelect,
  onDelete,
  accentOf,
  projectName,
}: Pick<SidebarProps, "sessions" | "activeId" | "onSelect" | "onDelete" | "accentOf" | "projectName">) {
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
  // nest inside another button.
  return sessions.map((s) => {
    const active = s.id === activeId;
    return (
      <div
        key={s.id}
        className={cn(
          "group mb-0.5 flex items-start gap-1 rounded-lg px-2.5 py-2 transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "hover:bg-sidebar-accent/60",
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(s.id)}
          aria-current={active ? "true" : undefined}
          className="focus-visible:ring-ring min-w-0 flex-1 cursor-pointer rounded-sm text-left outline-none focus-visible:ring-2"
        >
          <span className="flex items-center gap-1.5">
            <HarnessBadge harness={s.harness} accent={accentOf(s.harness)} />
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
            <span className="text-muted-foreground ml-auto shrink-0 font-mono text-[10px]">
              {ago(s.updatedAt)}
            </span>
          </span>
          <span className="mt-1 block truncate text-[13px]">{s.title || "Untitled"}</span>
          <span className="text-muted-foreground block truncate font-mono text-[10px]">
            {projectName(s.projectId) ?? s.cwd.split("/").slice(-2).join("/")}
            {s.branch ? ` · ${s.branch}` : ""}
          </span>
        </button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete session ${s.title || "Untitled"}`}
              onClick={() => onDelete(s.id)}
              className="hover:text-destructive -mr-1 size-11 shrink-0 md:size-8 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
            >
              <XIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete session</TooltipContent>
        </Tooltip>
      </div>
    );
  });
}

/** The panel itself, identical whether it is docked or in the mobile sheet. */
function SidebarPanel({ inSheet, ...props }: SidebarProps & { inSheet?: boolean }) {
  return (
    <div className="bg-sidebar text-sidebar-foreground flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "flex items-center gap-2 px-4 pt-[calc(0.875rem+env(safe-area-inset-top))] pb-3",
          // The sheet puts its own close button in this corner, so the status
          // dot moves out from under it rather than sitting behind it.
          inSheet && "pr-12",
        )}
      >
        <span className="font-mono text-sm font-semibold tracking-tight">hy</span>
        <span className="text-muted-foreground flex-1 text-[11px]">harness multiplexer</span>
        <StatusDot status={props.status} />
      </div>

      <div className="px-3 pb-3">
        <Button className="min-h-11 w-full md:min-h-9" onClick={props.onNew}>
          <PlusIcon />
          New session
        </Button>
      </div>

      <Separator />

      <nav aria-label="Sessions" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <SessionList {...props} />
      </nav>

      <Separator />

      <div className="flex items-center gap-2 px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <span className="text-muted-foreground flex-1 text-[11px]">
          {props.sessions.length} session{props.sessions.length === 1 ? "" : "s"}
        </span>
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
          className="w-[min(20rem,85vw)] gap-0 p-0 pl-[env(safe-area-inset-left)]"
        >
          <SheetTitle className="sr-only">Sessions</SheetTitle>
          <SidebarPanel {...props} inSheet />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      // Collapsed it is off-screen but still in the document, so it is taken
      // out of the tab order rather than being a set of controls you can focus
      // but not see.
      inert={!props.open}
      className={cn(
        "w-72 shrink-0 border-r transition-[margin] duration-200 motion-reduce:transition-none",
        !props.open && "-ml-72",
      )}
    >
      <SidebarPanel {...props} />
    </aside>
  );
}
