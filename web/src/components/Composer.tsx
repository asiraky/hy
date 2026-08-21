import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ContextMeter } from "~/components/ContextMeter";
import { ModelPicker } from "~/components/ModelPicker";
import { Button } from "~/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "~/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "~/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "~/components/ui/sheet";
import {
  detectComposerTrigger,
  rankComposerItems,
  replaceComposerTrigger,
  submittedComposerAction,
} from "~/lib/composerItems";
import type { ComposerItem, HarnessMeta, Usage } from "~/protocol";
import { useIsDesktop } from "~/useMediaQuery";

export function Composer({
  draft,
  onDraftChange,
  disabled,
  busy,
  onSend,
  onCancel,
  disabledPlaceholder,
  harnesses = [],
  harness = "",
  instance = "",
  model = "",
  effort = "",
  onSwitchModel,
  usage,
  loadComposerItems,
  onRunClientAction,
  onRunComposerAction,
}: {
  /**
   * The in-progress message. Owned by the parent and keyed per session there,
   * so it survives this component being unmounted and remounted across a
   * session switch — the draft is not this component's to lose.
   */
  draft: string;
  onDraftChange: (text: string) => void;
  disabled: boolean;
  busy: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  disabledPlaceholder?: string;
  /** Every harness the server reports; the picker reads this session's out. */
  harnesses?: HarnessMeta[];
  /** The attached session's harness and account, which it cannot change. */
  harness?: string;
  instance?: string;
  model?: string;
  effort?: string;
  onSwitchModel?: (id: string) => void;
  /** The session's token usage, source of the context meter. */
  usage?: Usage;
  loadComposerItems?: () => Promise<ComposerItem[]>;
  onRunClientAction?: (action: string) => void;
  onRunComposerAction?: (action: string, args: string, invocation: string) => Promise<void>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // There is no ⇧↵ worth advertising on a phone, so keep the hint to desktop.
  const isDesktop = useIsDesktop();
  const [providerItems, setProviderItems] = useState<ComposerItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [catalogueReady, setCatalogueReady] = useState(!loadComposerItems);
  const loadSequence = useRef(0);
  const draftRef = useRef(draft);
  const [cursor, setCursor] = useState(draft.length);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedTrigger, setDismissedTrigger] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);

  const items = useMemo<ComposerItem[]>(() => {
    const clientItems: ComposerItem[] = [
      {
        id: "client:model",
        name: "model",
        description: "Switch response model for this session",
        kind: "command",
        trigger: "/",
        insertText: "/model",
        origin: "built-in",
        behavior: "client-action",
        action: "model",
      },
    ];
    const claimed = new Set(clientItems.map((item) => `${item.trigger}\0${item.insertText}`));
    return [
      ...clientItems,
      ...providerItems.filter((item) => !claimed.has(`${item.trigger}\0${item.insertText}`)),
    ];
  }, [providerItems]);

  const reloadItems = useCallback(() => {
    if (!loadComposerItems) {
      setProviderItems([]);
      setCatalogueReady(true);
      return;
    }
    const sequence = ++loadSequence.current;
    setLoadingItems(true);
    loadComposerItems()
      .then((next) => {
        if (sequence === loadSequence.current) {
          setProviderItems(next);
          setCatalogueReady(true);
        }
      })
      .catch(() => {
        // Retain a previously successful catalogue. If the first request
        // failed, catalogueReady remains false and slash text is not sent as
        // a prompt while its behavior is unknown.
      })
      .finally(() => {
        if (sequence === loadSequence.current) setLoadingItems(false);
      });
  }, [loadComposerItems]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const changeDraft = useCallback(
    (next: string) => {
      draftRef.current = next;
      onDraftChange(next);
    },
    [onDraftChange],
  );

  useEffect(() => {
    reloadItems();
    return () => {
      loadSequence.current++;
    };
  }, [reloadItems]);

  // Grow with the content, up to a cap. Runs on mount too, so a restored draft
  // opens at the right height instead of a single collapsed row.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  const focusAt = useCallback((nextCursor: number) => {
    window.requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
      setCursor(nextCursor);
    });
  }, []);

  const trigger = useMemo(
    () => detectComposerTrigger(draft, cursor, items),
    [draft, cursor, items],
  );

  // Provider catalogues can change while a session is open. Refresh at the
  // start of each completion interaction; native adapters remain authoritative
  // without making the core subscribe to provider-specific invalidations.
  useEffect(() => {
    if (trigger?.query === "") reloadItems();
  }, [reloadItems, trigger?.trigger]); // query deliberately omitted: once per trigger opening
  const triggerKey = trigger ? `${trigger.start}:${trigger.end}:${trigger.trigger}:${trigger.query}` : "";
  const matches = useMemo(
    () => (trigger ? rankComposerItems(items, trigger) : []),
    [items, trigger],
  );
  const menuOpen = Boolean(
    trigger && triggerKey !== dismissedTrigger && !disabled && composerFocused,
  );

  useEffect(() => setActiveIndex(0), [triggerKey]);

  const choose = useCallback(
    (item: ComposerItem) => {
      if (!trigger) return;
      if (item.behavior === "client-action" && item.action) {
        const next = replaceComposerTrigger(draft, trigger, "");
        changeDraft(next.value);
        setDismissedTrigger(triggerKey);
        if (item.action === "model") {
          // Let the command popover close before opening the picker. Focusing
          // the textarea here would immediately dismiss the newly opened picker.
          window.requestAnimationFrame(() => setModelPickerOpen(true));
        } else {
          onRunClientAction?.(item.action);
        }
        return;
      }
      if (item.behavior === "adapter-action" && item.action) {
        const next = replaceComposerTrigger(draft, trigger, "");
        setDismissedTrigger(triggerKey);
        // Keep the literal command in place if the provider rejects it; App
        // has already surfaced the error and the user can retry or edit it.
        const submittedDraft = draft;
        void onRunComposerAction?.(item.action, "", item.insertText)
          .then(() => {
            if (draftRef.current === submittedDraft) changeDraft(next.value);
          })
          .catch(() => {});
        return;
      }
      const next = replaceComposerTrigger(draft, trigger, `${item.insertText} `);
      changeDraft(next.value);
      setDismissedTrigger(triggerKey);
      focusAt(next.cursor);
    },
    [changeDraft, draft, focusAt, onRunClientAction, onRunComposerAction, trigger, triggerKey],
  );

  const send = async () => {
    const t = draft.trim();
    if (!t || disabled) return;
    if (t.startsWith("/") && !catalogueReady) return;
    const intercepted = submittedComposerAction(t, items);
    if (intercepted?.item.behavior === "client-action") {
      changeDraft("");
      if (intercepted.item.action === "model") {
        window.requestAnimationFrame(() => setModelPickerOpen(true));
      } else if (intercepted.item.action) {
        onRunClientAction?.(intercepted.item.action);
      }
      return;
    }
    if (intercepted?.item.behavior === "adapter-action" && intercepted.item.action) {
      try {
        const submittedDraft = draftRef.current;
        await onRunComposerAction?.(intercepted.item.action, intercepted.args, t);
        if (draftRef.current === submittedDraft) changeDraft("");
      } catch {
        // App reports the provider error. Retain the command so it can be
        // retried or edited, without leaving a rejected promise behind.
      }
      return;
    }
    onSend(t);
    changeDraft("");
  };

  const menu = (
    <Command shouldFilter={false} className="bg-transparent">
      <CommandList className="max-h-[min(45dvh,18rem)]">
        <CommandEmpty>{loadingItems ? "Loading commands…" : "No matching command."}</CommandEmpty>
        <CommandGroup>
          {matches.map((item, index) => (
            <CommandItem
              key={item.id}
              value={item.id}
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "bg-accent text-accent-foreground" : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActiveIndex(index)}
              onSelect={() => choose(item)}
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{item.insertText}</span>
                {item.argsHint && <span className="text-muted-foreground ml-1">{item.argsHint}</span>}
                {item.description && (
                  <span className="text-muted-foreground ml-2 text-xs">{item.description}</span>
                )}
              </span>
              {item.origin && (
                <span className="text-muted-foreground shrink-0 text-[11px]">[{item.origin}]</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );

  const textarea = (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      disabled={disabled}
      aria-label="Message"
      placeholder={
        disabled
          ? (disabledPlaceholder ?? "Session closed")
          : isDesktop
            ? "Ask anything…  (↵ to send · ⇧↵ for newline)"
            : "Ask anything…"
      }
      onChange={(e) => {
        changeDraft(e.target.value);
        setCursor(e.target.selectionStart);
      }}
      onFocus={() => setComposerFocused(true)}
      onBlur={() => setComposerFocused(false)}
      onClick={(e) => setCursor(e.currentTarget.selectionStart)}
      onKeyUp={(e) => setCursor(e.currentTarget.selectionStart)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (menuOpen) {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (matches.length > 0) {
              const offset = e.key === "ArrowDown" ? 1 : -1;
              setActiveIndex((index) => (index + offset + matches.length) % matches.length);
            }
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setDismissedTrigger(triggerKey);
            return;
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            if (matches.length > 0) {
              choose(matches[Math.min(activeIndex, matches.length - 1)]!);
            }
            return;
          }
        }
        if (e.key !== "Enter") return;
        // Shift+Enter is the newline; let the textarea handle it.
        if (e.shiftKey) return;
        e.preventDefault();
        void send();
      }}
      // 16px on a phone: anything smaller makes iOS zoom the viewport on
      // focus, which breaks the layout the dvh handling just fixed.
      className="scroll-thin placeholder:text-muted-foreground max-h-[200px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[16px] leading-relaxed focus:outline-none disabled:opacity-60 md:text-[14px]"
    />
  );

  return (
    <div className="mx-auto max-w-3xl px-4 pb-[calc(0.875rem+env(safe-area-inset-bottom))] md:px-5">
      <div className="bg-card focus-within:border-ring focus-within:ring-ring/50 rounded-2xl border shadow-lg transition-[color,box-shadow] focus-within:ring-[3px]">
        {isDesktop ? (
          <Popover open={menuOpen}>
            <PopoverAnchor asChild>{textarea}</PopoverAnchor>
            <PopoverContent
              side="top"
              align="start"
              onOpenAutoFocus={(event) => event.preventDefault()}
              className="w-[min(40rem,calc(100vw-2rem))] p-0"
            >
              {menu}
            </PopoverContent>
          </Popover>
        ) : (
          <>
            {textarea}
            <Sheet
              modal={false}
              open={menuOpen}
              onOpenChange={(open) => {
                if (!open) setDismissedTrigger(triggerKey);
              }}
            >
              <SheetContent
                side="bottom"
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="max-h-[70dvh] p-0 pb-[env(safe-area-inset-bottom)]"
              >
                <SheetHeader><SheetTitle>Commands</SheetTitle></SheetHeader>
                {menu}
              </SheetContent>
            </Sheet>
          </>
        )}

        <div className="flex items-center gap-1 px-2.5 pb-2">
          {usage && (usage.contextUsed ?? 0) > 0 && <ContextMeter usage={usage} model={model} />}

          <span className="flex-1" />

          {harnesses.length > 0 && (
            // The same picker the new-session dialog uses, with the account
            // fixed: the harness is already running under it, so only the
            // model is still a choice.
            <ModelPicker
              harnesses={harnesses}
              lockInstance
              disabled={disabled}
              value={{ harness, instance, model }}
              onChange={(next) => onSwitchModel?.(next.model)}
              open={modelPickerOpen}
              onOpenChange={setModelPickerOpen}
              className="text-muted-foreground hover:text-foreground h-11 w-auto max-w-[45%] min-w-0 border-0 px-2 shadow-none md:h-8 md:min-h-8"
            />
          )}
          {effort && (
            <span className="text-muted-foreground shrink-0 text-[12px] capitalize">{effort}</span>
          )}

          {busy ? (
            <Button
              variant="destructive"
              size="icon"
              onClick={onCancel}
              aria-label="Interrupt the running turn"
              title="Interrupt the running turn"
              className="size-11 rounded-full md:size-8"
            >
              <SquareIcon className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              disabled={disabled || !draft.trim()}
              onClick={() => void send()}
              aria-label="Send"
              className="size-11 rounded-full md:size-8"
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
