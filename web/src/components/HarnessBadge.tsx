import type { CSSProperties } from "react";

import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

/**
 * The accent colour travels with the harness from the server. This component
 * has no per-harness knowledge, so a new adapter styles itself — it only hands
 * the colour to the badge's `accent` variant as a custom property.
 */
export function HarnessBadge({
  harness,
  accent,
  className,
}: {
  harness: string;
  accent?: string;
  className?: string;
}) {
  return (
    <Badge
      variant={accent ? "accent" : "secondary"}
      style={accent ? ({ "--badge-accent": accent } as CSSProperties) : undefined}
      className={cn(
        "rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase",
        className,
      )}
    >
      {harness}
    </Badge>
  );
}
