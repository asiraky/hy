import type { ComponentProps, ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

/**
 * Every icon-only control in the app goes through here, which is what makes
 * "has an accessible name" and "is big enough for a thumb" properties of the
 * component rather than of whoever remembered them. The label is required, and
 * it is both the accessible name and the tooltip text.
 */
export function IconButton({
  label,
  children,
  className,
  variant = "ghost",
  ...props
}: Omit<ComponentProps<typeof Button>, "size" | "aria-label"> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          {...props}
          variant={variant}
          size="icon"
          aria-label={label}
          // 44px is the touch target on a phone; a pointer needs no such
          // slack, so on desktop the button hugs its 16px icon — the same
          // 32px square as the sidebar rows' delete X.
          className={cn("size-11 shrink-0 md:size-8", className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
