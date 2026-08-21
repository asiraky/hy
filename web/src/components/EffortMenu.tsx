import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Command, CommandGroup, CommandItem, CommandList } from "~/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "~/components/ui/sheet";
import { formatEffort } from "~/lib/efforts";
import { cn } from "~/lib/utils";
import { useIsDesktop } from "~/useMediaQuery";

/**
 * The reasoning-effort control, as one row at the foot of the model dropdown.
 *
 * It used to be a second dropdown beside the model one, and two controls for
 * what is really one decision — what runs this turn — crowded the send button
 * and made the composer read as a toolbar. Effort is still its own axis, so it
 * is still its own list; it just opens out of the model menu the way a submenu
 * does, rather than competing with it for space.
 */
export function EffortMenu({
  efforts,
  value,
  projectDefault = "",
  onChange,
}: {
  /** Levels the running model accepts, most modest first. */
  efforts: string[];
  /** The active effort, or "" for no level named. */
  value: string;
  /**
   * The project's default level, if it sets one. It is the level a session
   * starts at when nothing is chosen, which is what the "Default" badge marks.
   */
  projectDefault?: string;
  onChange: (effort: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isDesktop = useIsDesktop();

  const choose = (effort: string) => {
    setOpen(false);
    if (effort !== value) onChange(effort);
  };

  // Which row is the one you get by not choosing. A project default only
  // counts if this model actually accepts it; otherwise nothing is promised
  // beyond "the harness decides", and the auto row is that promise.
  const badged = projectDefault && efforts.includes(projectDefault) ? projectDefault : "";

  const trigger = (
    <button
      type="button"
      role="combobox"
      aria-expanded={open}
      aria-label="Reasoning effort"
      className="focus-visible:ring-ring hover:bg-accent hover:text-accent-foreground flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors outline-none focus-visible:ring-2 md:min-h-9"
    >
      <span className="flex-1">Effort</span>
      <span className="text-muted-foreground text-[12px]">{formatEffort(value)}</span>
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
    </button>
  );

  const body = (
    <Command shouldFilter={false} className="bg-transparent">
      <CommandList>
        <CommandGroup heading="Reasoning effort">
          <EffortRow
            effort=""
            hint={
              badged
                ? `Uses ${formatEffort(badged)}, this project's default`
                : "Whatever the harness picks"
            }
            selected={value === ""}
            isDefault={!badged}
            onChoose={choose}
          />
          {efforts.map((effort) => (
            <EffortRow
              key={effort}
              effort={effort}
              selected={effort === value}
              isDefault={effort === badged}
              onChoose={choose}
            />
          ))}
        </CommandGroup>
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
      {/* Beside the model menu rather than under it, which is what makes it
          read as a submenu of the row that opened it. */}
      <PopoverContent side="right" align="end" sideOffset={8} className="w-60 p-0">
        {body}
      </PopoverContent>
    </Popover>
  );
}

/** One level: its name, the badge if it is the one you get by default. */
function EffortRow({
  effort,
  hint,
  selected,
  isDefault,
  onChoose,
}: {
  effort: string;
  hint?: string;
  selected: boolean;
  isDefault: boolean;
  onChoose: (effort: string) => void;
}) {
  return (
    <CommandItem
      value={effort || "__auto__"}
      onSelect={() => onChoose(effort)}
      className="min-h-11 items-start gap-2 py-2 md:min-h-0"
    >
      <CheckIcon className={cn("mt-0.5 size-4 shrink-0", !selected && "opacity-0")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px]">{formatEffort(effort)}</span>
          {isDefault && (
            <Badge variant="secondary" className="ml-auto shrink-0 px-1.5 py-0 text-[10px]">
              Default
            </Badge>
          )}
        </span>
        {hint && <span className="text-muted-foreground block truncate text-[11px]">{hint}</span>}
      </span>
    </CommandItem>
  );
}

/**
 * The running model's context window, stated where the model is chosen. It is
 * a fact of the model rather than a knob — the harness fixes the window per
 * model — so it is said, never offered.
 */
export function ContextNote({ label }: { label: string }) {
  return (
    <div className="text-muted-foreground border-t px-3 py-2 text-[11px]">
      Context window: <span className="text-foreground">{label}</span>
      <span className="block text-[10px]">Set by the model — not adjustable.</span>
    </div>
  );
}
