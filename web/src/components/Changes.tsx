import { ChevronRightIcon, FileDiffIcon, Maximize2Icon, Minimize2Icon, RefreshCwIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Diff } from "~/components/Diff";
import { IconButton } from "~/components/IconButton";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import type { ChangedFile, FileDiff, SessionChanges } from "~/protocol";
import { useIsDesktop } from "~/useMediaQuery";

const WIDTH_KEY = "hy.changesWidth";
const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 460;

const STATUS_LABEL: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
};

const STATUS_TONE: Record<string, string> = {
  added: "text-success",
  modified: "text-attention-foreground",
  deleted: "text-destructive",
  renamed: "text-muted-foreground",
  copied: "text-muted-foreground",
};

export interface ChangesProps {
  open: boolean;
  onClose: () => void;
  /** One click to the full content width, one click back. No in-between. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /** Changes are re-read when this changes — when a turn ends, in practice. */
  revision: string;
  loadChanges: () => Promise<SessionChanges>;
  loadDiff: (path: string) => Promise<FileDiff>;
  /**
   * A file to open and scroll to, set when someone clicks a path in a turn's
   * card. The nonce changes on every request, so asking for the same file twice
   * still brings it back into view.
   */
  reveal?: { path: string; nonce: number } | null;
}

function Counts({ additions, deletions, binary }: { additions: number; deletions: number; binary?: boolean }) {
  if (binary) return <span className="text-muted-foreground font-mono text-[10px]">binary</span>;
  return (
    <span className="shrink-0 font-mono text-[10px] tabular-nums">
      <span className="text-success">+{additions}</span>{" "}
      <span className="text-destructive">−{deletions}</span>
    </span>
  );
}

function FileRow({
  file,
  rowRef,
  expanded,
  diff,
  loading,
  error,
  onToggle,
}: {
  file: ChangedFile;
  rowRef?: (el: HTMLDivElement | null) => void;
  expanded: boolean;
  diff?: FileDiff;
  loading: boolean;
  error?: string;
  onToggle: () => void;
}) {
  const slash = file.path.lastIndexOf("/");
  const dir = slash === -1 ? "" : file.path.slice(0, slash + 1);
  const name = slash === -1 ? file.path : file.path.slice(slash + 1);

  return (
    <div ref={rowRef} className="border-b last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="hover:bg-accent/40 focus-visible:ring-ring flex min-h-11 w-full items-center gap-2 px-2 py-1.5 text-left outline-none focus-visible:ring-2 md:min-h-0"
      >
        <ChevronRightIcon
          className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
        />
        <span
          className={cn("w-3 shrink-0 text-center font-mono text-[11px]", STATUS_TONE[file.status])}
          title={file.status}
        >
          {STATUS_LABEL[file.status] ?? "M"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={file.path}>
          <span className="text-muted-foreground">{dir}</span>
          {name}
          {file.oldPath && (
            <span className="text-muted-foreground"> ← {file.oldPath}</span>
          )}
        </span>
        <Counts additions={file.additions} deletions={file.deletions} binary={file.binary} />
      </button>

      {expanded && (
        <div className="bg-muted/20 border-t">
          {loading && (
            <p className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-[12px]">
              <Spinner className="text-primary size-3.5" /> Reading the diff…
            </p>
          )}
          {error && <p className="text-destructive px-3 py-2 font-mono text-[11px]">{error}</p>}
          {diff && !loading && !error && (
            <div className="scroll-thin max-h-[60vh] overflow-auto overscroll-contain">
              {diff.binary ? (
                <p className="text-muted-foreground px-3 py-2 text-[12px]">
                  Binary file — nothing to show as text.
                </p>
              ) : (
                <>
                  <Diff patch={diff.patch} />
                  {diff.truncated && (
                    <p className="text-muted-foreground px-3 py-2 text-[11px] italic">
                      Diff truncated — open the file in the worktree to see the rest.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChangesBody({ open, onClose, expanded: panelExpanded, onToggleExpanded, revision, loadChanges, loadDiff, reveal, inSheet }: ChangesProps & { inSheet?: boolean }) {
  const [changes, setChanges] = useState<SessionChanges | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, { diff?: FileDiff; loading: boolean; error?: string }>>({});

  // Paths already asked for, so expanding a row twice does not re-read it.
  const requested = useRef(new Set<string>());
  // Row elements, so a revealed file can be scrolled to.
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // A refresh that started earlier must not overwrite a later one's answer.
  const generation = useRef(0);
  // The loaders are held by ref: a parent that re-creates them on every render
  // must not turn "read the worktree once" into a loop.
  const loadRef = useRef(loadChanges);
  loadRef.current = loadChanges;
  const diffRef = useRef(loadDiff);
  diffRef.current = loadDiff;

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const next = await loadRef.current();
      if (mine !== generation.current) return;
      setChanges(next);
      // A diff read before this refresh describes a worktree that has moved on.
      requested.current.clear();
      setDiffs({});
    } catch (e) {
      if (mine !== generation.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, []);

  // Opening reads the worktree, and so does the end of a turn: the agent has
  // just stopped writing, which is exactly when the list is worth re-reading.
  useEffect(() => {
    if (open) void refresh();
  }, [open, revision, refresh]);

  const toggle = useCallback((path: string, forceOpen = false) => {
    setExpanded((current) => (current === path && !forceOpen ? null : path));
    if (requested.current.has(path)) return;
    requested.current.add(path);
    // A diff read against the list we were showing describes that list. If a
    // refresh lands first, this answer is about a worktree that has moved on.
    const mine = generation.current;
    setDiffs((d) => ({ ...d, [path]: { loading: true } }));
    void diffRef.current(path)
      .then((diff) => {
        if (mine !== generation.current) return;
        setDiffs((d) => ({ ...d, [path]: { diff, loading: false } }));
      })
      .catch((e) => {
        if (mine !== generation.current) return;
        requested.current.delete(path);
        setDiffs((d) => ({
          ...d,
          [path]: { loading: false, error: e instanceof Error ? e.message : String(e) },
        }));
      });
  }, []);

  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  const files = changes?.files ?? [];

  // Reveal whatever the transcript asked for, once the list it belongs to has
  // arrived. A path the list does not carry is not an error: the file may have
  // been changed by an earlier turn and put back since.
  useEffect(() => {
    if (!reveal || !open) return;
    if (!files.some((f) => f.path === reveal.path)) return;
    setExpanded(reveal.path);
    if (!requested.current.has(reveal.path)) toggleRef.current(reveal.path, true);
    const row = rowRefs.current.get(reveal.path);
    row?.scrollIntoView({ block: "start", behavior: "smooth" });
    // The nonce is what makes a repeat click count as a new request.
  }, [reveal?.path, reveal?.nonce, open, files]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "flex items-center gap-1.5 border-b px-2 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-2",
          inSheet && "pr-12",
        )}
      >
        <FileDiffIcon className="text-muted-foreground ml-1 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">Changes</p>
          <p className="text-muted-foreground truncate font-mono text-[10px]">
            {changes?.branch ?? "…"}
            {changes?.baseRef && ` vs ${changes.baseRef}`}
          </p>
        </div>
        <IconButton label="Re-read the worktree" onClick={() => void refresh()}>
          <RefreshCwIcon className={cn(loading && "animate-spin")} />
        </IconButton>
        {!inSheet && onToggleExpanded && (
          <IconButton
            label={panelExpanded ? "Restore the panel" : "Expand to full width"}
            onClick={onToggleExpanded}
          >
            {panelExpanded ? <Minimize2Icon /> : <Maximize2Icon />}
          </IconButton>
        )}
        {!inSheet && (
          <IconButton label="Close changes" onClick={onClose}>
            <XIcon />
          </IconButton>
        )}
      </div>

      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-[12px]">
          {files.length} file{files.length === 1 ? "" : "s"} changed
        </span>
        <span className="flex-1" />
        {changes && <Counts additions={changes.additions} deletions={changes.deletions} />}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {error && (
          <div className="text-destructive flex items-start gap-2 px-3 py-3 text-[12px]">
            <TriangleAlertIcon className="size-4 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}
        {!error && changes?.warning && (
          <p className="text-muted-foreground px-3 py-6 text-center text-[12px]">{changes.warning}</p>
        )}
        {!error && !changes?.warning && files.length === 0 && (
          <p className="text-muted-foreground px-3 py-10 text-center text-[12px]">
            {loading && !changes ? "Reading the worktree…" : "Nothing changed yet."}
          </p>
        )}
        {files.map((f) => (
          <FileRow
            key={f.path}
            file={f}
            rowRef={(el) => {
              if (el) rowRefs.current.set(f.path, el);
              else rowRefs.current.delete(f.path);
            }}
            expanded={expanded === f.path}
            diff={diffs[f.path]?.diff}
            loading={!!diffs[f.path]?.loading}
            error={diffs[f.path]?.error}
            onToggle={() => toggle(f.path)}
          />
        ))}
        {changes?.truncated && (
          <p className="text-muted-foreground px-3 py-2 text-[11px] italic">
            Only the first files are listed; this session changed more than the panel will show.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The changed-file list, docked to the right on a desktop and a full-screen
 * overlay on a phone — where a squeezed side panel would leave neither the
 * transcript nor the diff readable.
 */
export function Changes(props: ChangesProps) {
  const isDesktop = useIsDesktop();
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH ? stored : DEFAULT_WIDTH;
  });
  const dragging = useRef(false);

  // Escape closes the docked panel. The sheet does this for itself.
  useEffect(() => {
    if (!props.open || !isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      // A dialog or sheet over the panel owns Escape first; closing both at
      // once would dismiss something the user was not looking at.
      if (e.key !== "Escape" || document.querySelector("[role=dialog]")) return;
      props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose, isDesktop]);

  useEffect(() => {
    if (!dragging.current) localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  const startDrag = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    const max = () => Math.max(MIN_WIDTH, window.innerWidth - 360);
    const onMove = (m: PointerEvent) =>
      setWidth(Math.min(max(), Math.max(MIN_WIDTH, window.innerWidth - m.clientX)));
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setWidth((w) => {
        localStorage.setItem(WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  if (!props.open) return null;

  if (!isDesktop) {
    return (
      <Sheet open onOpenChange={(v) => !v && props.onClose()}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-none">
          <SheetTitle className="sr-only">Changed files</SheetTitle>
          <ChangesBody {...props} inSheet />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      // Expanded, the panel is the content area: the main column hides and
      // this fills what is left beside the sidebar.
      style={props.expanded ? undefined : { width }}
      className={cn("relative flex flex-col border-l", props.expanded ? "min-w-0 flex-1" : "shrink-0")}
      aria-label="Changed files"
    >
      {!props.expanded && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the changes panel"
          onPointerDown={startDrag}
          className="hover:bg-primary/40 absolute inset-y-0 -left-1 w-2 cursor-col-resize"
        />
      )}
      <ChangesBody {...props} />
    </aside>
  );
}
