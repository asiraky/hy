import { CheckIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "~/components/ui/sheet";
import { cn } from "~/lib/utils";
import { useIsDesktop } from "~/useMediaQuery";

/**
 * The reasoning-effort control — a sibling of the model picker, never merged
 * into it. It changes how hard the model thinks (its own axis) and, in the same
 * dropdown, states the context window the running model gives you, which is a
 * fact of the model rather than a knob: Claude Code fixes the window per model,
 * so there is nothing to toggle, only to see.
 */
export function EffortPicker({
  efforts,
  value,
  contextLabel,
  disabled = false,
  onChange,
  className,
}: {
  /** Levels the running model accepts, most modest first. */
  efforts: string[];
  /** The active effort, or "" for the harness default. */
  value: string;
  /** The running model's context window, already formatted ("1M"), or "". */
  contextLabel?: string;
  disabled?: boolean;
  onChange: (effort: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const isDesktop = useIsDesktop();

  const choose = (effort: string) => {
    setOpen(false);
    if (effort !== value) onChange(effort);
  };

  const trigger = (
    <Button
      variant="outline"
      role="combobox"
      aria-expanded={open}
      aria-label="Reasoning effort"
      disabled={disabled}
      className={cn(
        "text-muted-foreground hover:text-foreground h-11 shrink-0 gap-1.5 border-0 px-2 shadow-none md:h-8 md:min-h-8",
        className,
      )}
    >
      <span className="text-[12px] capitalize">{value || "Effort"}</span>
    </Button>
  );

  const body = (
    <Command shouldFilter={false} className="bg-transparent">
      <CommandList>
        <CommandGroup heading="Reasoning">
          {efforts.map((effort) => (
            <CommandItem
              key={effort}
              value={effort}
              onSelect={() => choose(effort)}
              className="min-h-11 items-center gap-2 py-2 capitalize md:min-h-0"
            >
              <CheckIcon className={cn("size-4 shrink-0", effort !== value && "opacity-0")} />
              <span className="flex-1 text-[13px]">{effort}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {contextLabel && (
          <div className="text-muted-foreground border-t px-3 py-2 text-[11px]">
            Context window: <span className="text-foreground">{contextLabel}</span>
            <span className="block text-[10px]">Set by the model — not adjustable.</span>
          </div>
        )}
      </CommandList>
    </Command>
  );

  if (!isDesktop) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="p-0 pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="pb-0">
            <SheetTitle>Reasoning effort</SheetTitle>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        {body}
      </PopoverContent>
    </Popover>
  );
}

/** Formats a context-window token count as a compact label ("1M", "200k"). */
export function formatContextWindow(tokens: number | undefined): string {
  if (!tokens || tokens <= 0) return "";
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}
