import type { ReactNode } from "react";

// The header shared by the two turn-blocking cards (permission and
// elicitation). Instead of a loud coloured surface, attention is carried by a
// small pulsing dot next to a quiet uppercase label — enough to catch the eye
// without painting the whole band. Any trailing detail (a tool name, say) is
// passed as children.
export function AttentionLabel({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex size-2 shrink-0" aria-hidden>
        <span className="attention-ping bg-attention absolute inline-flex size-full rounded-full opacity-60" />
        <span className="bg-attention relative inline-flex size-2 rounded-full" />
      </span>
      <span className="text-attention-foreground font-mono text-[10px] font-medium tracking-wide uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}
