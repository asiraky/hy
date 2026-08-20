import { PlusIcon, RefreshCwIcon, SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { ConnectionStatus } from "~/client";
import { HarnessBadge } from "~/components/HarnessBadge";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";
import type { HarnessMeta, Issue, Project, UserConfig, Workspace } from "~/protocol";
import { WorkspacePicker, type WorkspaceChoice } from "./WorkspacePicker";

export interface NewSessionInput {
  projectId: string;
  harness: string;
  model: string;
  branch: string;
  workspace: string;
  workspacePath: string;
}

export interface WorkspaceListing {
  workspaces: Workspace[];
  issues: Issue[];
  issuesError: string;
}

export function NewSession({
  projects,
  harnesses,
  userConfig,
  onCreate,
  onListWorkspaces,
  onAddProject,
  onSettings,
  onRecheck,
  onClose,
  status,
}: {
  projects: Project[];
  harnesses: HarnessMeta[];
  userConfig: UserConfig | null;
  onCreate: (input: NewSessionInput) => Promise<void>;
  onListWorkspaces: (projectId: string) => Promise<WorkspaceListing>;
  onAddProject: () => void;
  onSettings: (project: Project) => void;
  onRecheck: () => void;
  onClose: () => void;
  status: ConnectionStatus;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [chosenHarness, setChosenHarness] = useState("");
  const [chosenModel, setChosenModel] = useState("");
  const [choice, setChoice] = useState<WorkspaceChoice>({ branch: "", attachPath: "" });
  const [listing, setListing] = useState<WorkspaceListing>({
    workspaces: [],
    issues: [],
    issuesError: "",
  });
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const harnessId =
    chosenHarness ||
    project?.config.defaults.harness ||
    harnesses.find((h) => h.availability.state === "ready")?.id ||
    harnesses[0]?.id ||
    "";
  const selected = harnesses.find((h) => h.id === harnessId);
  const model = selected?.models.some((m) => m.id === chosenModel)
    ? chosenModel
    : (project?.config.defaults.model ?? "");
  // Typing a branch name is itself the instruction to create a worktree, so it
  // outranks the project default; attaching overrides both and the server
  // decides the mode from the path.
  const branch = choice.attachPath ? "" : choice.branch.trim();
  const workspace = choice.attachPath
    ? ""
    : branch
      ? "managed"
      : (project?.config.defaults.workspace ?? "local");
  const ready = status === "online" && !!project && selected?.availability.state === "ready";

  const create = async () => {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        projectId: project.id,
        harness: harnessId,
        model,
        branch,
        workspace,
        workspacePath: choice.attachPath,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  // Worktrees and issues are read per project and re-read whenever the project
  // changes, so a stale list cannot offer a checkout that has since gone.
  useEffect(() => {
    if (!project) return;
    let live = true;
    setLoadingSpaces(true);
    setChoice({ branch: "", attachPath: "" });
    onListWorkspaces(project.id)
      .then((r) => {
        if (live) setListing(r);
      })
      .catch((e) => {
        if (live)
          setListing({
            workspaces: [],
            issues: [],
            issuesError: e instanceof Error ? e.message : String(e),
          });
      })
      .finally(() => {
        if (live) setLoadingSpaces(false);
      });
    return () => {
      live = false;
    };
  }, [project?.id, onListWorkspaces]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="scroll-thin max-h-[85dvh] gap-0 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            Pick a project. Hy prepares its workspace before starting the agent.
          </DialogDescription>
        </DialogHeader>

        {projects.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed p-6 text-center">
            <p className="text-muted-foreground text-[13px]">
              Add a project once, then create every session from here.
            </p>
            <Button className="mt-4" onClick={onAddProject}>
              <PlusIcon />
              Add project
            </Button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-session-project">Project</Label>
              <div className="flex gap-2">
                <Select
                  value={project?.id}
                  onValueChange={(v) => {
                    setProjectId(v);
                    setChosenHarness("");
                    setChosenModel("");
                  }}
                >
                  <SelectTrigger id="new-session-project" className="min-w-0 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.config.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Project settings"
                  title="Project settings"
                  onClick={() => project && onSettings(project)}
                >
                  <SettingsIcon />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Add project"
                  title="Add project"
                  onClick={onAddProject}
                >
                  <PlusIcon />
                </Button>
              </div>
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-foreground mb-1.5 text-sm leading-none font-medium">
                Harness
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {harnesses.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setChosenHarness(h.id)}
                    aria-pressed={harnessId === h.id}
                    className={cn(
                      "focus-visible:ring-ring flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors outline-none focus-visible:ring-2",
                      harnessId === h.id
                        ? "border-primary/60 bg-primary/10"
                        : "hover:bg-accent/50",
                      h.availability.state !== "ready" && "opacity-50",
                    )}
                  >
                    <HarnessBadge harness={h.id} accent={h.accent} />
                    <span className="truncate">{h.name}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {selected?.availability.state !== "ready" && (
              <Alert>
                <AlertDescription>
                  <span>{selected?.availability.reason}</span>
                  <Button variant="outline" size="sm" className="mt-2" onClick={onRecheck}>
                    <RefreshCwIcon />
                    Check again
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {(selected?.models.length ?? 0) > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="new-session-model">Model</Label>
                {/* An empty string is not a legal Radix Select value, so
                    "default" is its own sentinel and maps back to "". */}
                <Select
                  value={model || "default"}
                  onValueChange={(v) => setChosenModel(v === "default" ? "" : v)}
                >
                  <SelectTrigger id="new-session-model" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    {selected?.models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="new-session-workspace">Workspace</Label>
              <WorkspacePicker
                id="new-session-workspace"
                value={choice}
                onChange={setChoice}
                workspaces={listing.workspaces}
                issues={listing.issues}
                issuesError={listing.issuesError}
                userConfig={userConfig}
                loading={loadingSpaces}
                placeholder="issue/482-fix-login"
              />
            </div>
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription className="font-mono text-[11px]">{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="mt-6">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {projects.length > 0 && (
            <Button disabled={!ready || busy} onClick={create}>
              {busy ? "Opening…" : "Start"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
