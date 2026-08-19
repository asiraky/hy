import type { PendingPermission } from "../protocol";
import { Button } from "./ui";

// A permission request is durable session state, not a modal owned by this
// connection: it is rendered from the log, and any attached device can answer.
export function PermissionPrompt({
  request,
  onResolve,
}: {
  request: PendingPermission;
  onResolve: (outcome: string, optionId: string) => void;
}) {
  const detail =
    request.input && typeof request.input === "object"
      ? JSON.stringify(request.input, null, 2)
      : null;

  return (
    // Sits directly above the composer, so it is already where a thumb rests.
    <div className="attention-in shrink-0 border-t-2 border-amber-500/40 bg-amber-500/[0.08]">
      <div className="mx-auto max-w-3xl px-4 py-3.5 md:px-5">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] tracking-wide text-amber-400 uppercase">
            permission
          </span>
          <span className="font-mono text-[11px] text-ink-500">{request.toolName}</span>
        </div>

        <p className="mt-1.5 font-mono text-[13px] break-words text-ink-100">{request.title}</p>

        {detail && (
          <pre className="scroll-thin mt-2 max-h-20 overflow-auto overscroll-contain rounded bg-ink-950/60 p-2 font-mono text-[11px] leading-relaxed text-ink-500 md:max-h-32">
            {detail}
          </pre>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {request.options.map((o) => (
            <Button
              key={o.optionId}
              variant={o.kind.startsWith("allow") ? "primary" : "danger"}
              className="flex-1 whitespace-nowrap md:flex-none"
              onClick={() => onResolve(o.kind, o.optionId)}
            >
              {o.name}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
