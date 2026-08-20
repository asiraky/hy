import type { ConnectionStatus } from "~/client";
import { cn } from "~/lib/utils";

const TONE: Record<ConnectionStatus, string> = {
  online: "bg-success",
  connecting: "bg-attention",
  offline: "bg-destructive",
};

const LABEL: Record<ConnectionStatus, string> = {
  online: "Connected",
  connecting: "Connecting",
  offline: "Disconnected",
};

/**
 * Colour is the whole signal here, so the state is also said in text for
 * anything that cannot see it.
 */
export function StatusDot({ status, className }: { status: ConnectionStatus; className?: string }) {
  return (
    <span
      role="status"
      aria-label={LABEL[status]}
      className={cn("relative flex size-2 shrink-0", className)}
    >
      {status !== "offline" && (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:animate-none",
            TONE[status],
          )}
        />
      )}
      <span className={cn("relative inline-flex size-2 rounded-full", TONE[status])} />
    </span>
  );
}
