import { ShieldQuestionMarkIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import type { PendingPermission } from "~/protocol";

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
    // The attention band is a theme role, not a hardcoded amber, so it reads
    // as deliberate in both themes rather than glowing in one of them.
    <div
      role="group"
      aria-label="Permission request"
      className="attention-in border-attention bg-attention-surface shrink-0 border-t-2"
    >
      <div className="mx-auto max-w-3xl px-4 py-3.5 md:px-5">
        <div className="flex items-center gap-2">
          <ShieldQuestionMarkIcon className="text-attention-foreground size-3.5 shrink-0" />
          <span className="text-attention-foreground font-mono text-[10px] tracking-wide uppercase">
            permission
          </span>
          <span className="text-muted-foreground font-mono text-[11px]">{request.toolName}</span>
        </div>

        <p className="mt-1.5 font-mono text-[13px] break-words">{request.title}</p>

        {detail && (
          <pre className="scroll-thin bg-muted text-muted-foreground mt-2 max-h-20 overflow-auto overscroll-contain rounded-md p-2 font-mono text-[11px] leading-relaxed md:max-h-32">
            {detail}
          </pre>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {request.options.map((o) => (
            <Button
              key={o.optionId}
              // Allowing is the affirmative act and reads as the primary
              // button; anything else is a refusal and says so in red.
              variant={o.kind.startsWith("allow") ? "default" : "destructive"}
              className="min-h-11 flex-1 whitespace-nowrap md:min-h-9 md:flex-none"
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
