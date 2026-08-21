import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import type { SessionMeta } from "~/protocol";

/**
 * The one place a session is deleted from. Both the sidebar's X and the
 * transcript's "this landed" prompt open this, so the guards on what may be
 * removed from disk are written once and cannot drift apart.
 */
export function DeleteSessionDialog({
  session,
  sessions,
  projectRoot,
  onOpenChange,
  onDelete,
}: {
  /** The session being deleted, or null when the dialog is closed. */
  session: SessionMeta | null;
  /** Every session hy knows of, to see who else is in the same checkout. */
  sessions: SessionMeta[];
  /** The project's own checkout, which is never a worktree hy may remove. */
  projectRoot: (id?: string) => string | undefined;
  onOpenChange: (open: boolean) => void;
  /** removeWorktree is the user's answer to the checkbox, never inferred. */
  onDelete: (id: string, removeWorktree: boolean) => void;
}) {
  const [removeWorktree, setRemoveWorktree] = useState(false);

  // Defaulted on for a worktree hy provisioned, because that is what hy did
  // before and it is usually right; off for one it merely borrowed. Re-seeded
  // per session so a previous answer is never inherited by the next dialog.
  useEffect(() => {
    if (session) setRemoveWorktree(session.workspaceMode === "managed");
  }, [session]);

  const mode = session?.workspaceMode ?? "";
  // "The last session hy knows of" is a question the session list can already
  // answer: it holds every session's cwd. A closed session counts — it still
  // names that path, and hy still knows of it.
  const sharers = session
    ? sessions.filter((s) => s.id !== session.id && s.cwd === session.cwd)
    : [];
  // Only these two modes have a directory hy could remove. A local session is
  // the user's own checkout, and a session with no project has no lease at all
  // — offering a checkbox for either would be offering an action the server
  // will not perform. Nor does a managed session whose provisioning failed
  // before it got a directory: its cwd is still the project root, and the
  // server refuses to remove that whatever the dialog asked for.
  const hasWorktree =
    (mode === "managed" || mode === "borrowed") &&
    !!session?.cwd &&
    session.cwd !== projectRoot(session.projectId);
  const removable = hasWorktree && sharers.length === 0;

  return (
    <Dialog open={session !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete “{session?.title || "Untitled"}”?</DialogTitle>
          {/* Whatever else it says, it says plainly whether anything on disk
              is at risk. The old copy promised a worktree removal that a
              borrowed session never performed. */}
          <DialogDescription>
            {mode === "local"
              ? "This permanently deletes the session and its transcript. Your checkout is left untouched."
              : "This permanently deletes the session and its transcript."}
          </DialogDescription>
        </DialogHeader>

        {session && hasWorktree && (
          <div className="space-y-2 text-[12px]">
            {removable ? (
              <>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="delete-remove-worktree"
                    checked={removeWorktree}
                    onCheckedChange={(v) => setRemoveWorktree(v === true)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <Label htmlFor="delete-remove-worktree" className="cursor-pointer">
                      Also delete the worktree
                    </Label>
                    <span className="text-muted-foreground block font-mono text-[11px] break-all">
                      {session.cwd}
                    </span>
                  </div>
                </div>
                <p className="text-muted-foreground text-[11px]">
                  {session.branch
                    ? `The branch ${session.branch} is kept either way.`
                    : "Branches are never deleted."}
                  {mode === "borrowed" && " hy did not create this worktree."}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground text-[11px]">
                The worktree is left on disk: {sharers.length} other session
                {sharers.length === 1 ? "" : "s"} still
                {sharers.length === 1 ? " uses" : " use"} it
                {sharers[0]?.title ? ` (“${sharers[0].title}”)` : ""}.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              // The re-check at click time is the final guard: the dialog may
              // have been open while another session claimed the checkout.
              if (session) onDelete(session.id, removable && removeWorktree);
              onOpenChange(false);
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
