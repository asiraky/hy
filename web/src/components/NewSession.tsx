import { PlusIcon, RefreshCwIcon, SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { ConnectionStatus } from "~/client";
import { ModelPicker, type ModelSelection } from "~/components/ModelPicker";
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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { defaultModel, pickerInstances, resolveInstance } from "~/lib/models";
import { cn } from "~/lib/utils";
import type { HarnessMeta, Issue, Project, UserConfig, Workspace } from "~/protocol";
import { WorkspacePicker, type WorkspaceChoice } from "./WorkspacePicker";

export interface NewSessionInput {
  projectId: string;
  harness: string;
  /** The provider instance to run under; empty means the harness's default. */
  instance: string;
  model: string;
  mode: string;
  branch: string;
  workspace: string;
  workspacePath: string;
  /** The ref a new worktree branches from; empty defers to the project default. */
  baseRef: string;
}

/**
 * The five scenarios, as five things to click. They were all reachable before
 * — two of them only by knowing that an empty field meant something, or that a
 * dropdown on a "Branch" label also attached — which is not the same as being
 * offered.
 */
type WorkspaceKind = "main" | "branch" | "scratch" | "attach";

const WORKSPACE_KINDS: { id: WorkspaceKind; label: string; hint: string }[] = [
  { id: "main", label: "Main checkout", hint: "Works in the project directory itself." },
  {
    id: "branch",
    label: "New worktree from issue or branch name",
    hint: "A fresh checkout on a branch you name.",
  },
  { id: "scratch", label: "New scratch worktree", hint: "No name needed — hy picks one." },
  {
    id: "attach",
    label: "Attach to existing worktree",
    hint: "Run in a checkout that is already there.",
  },
];

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
  // One selection covers both: picking a model picks the account it lives
  // under, so there is nothing to keep in step.
  const [chosen, setChosen] = useState<ModelSelection | null>(null);
  const [chosenMode, setChosenMode] = useState("");
  const [choice, setChoice] = useState<WorkspaceChoice>({ branch: "", attachPath: "" });
  // "" defers to the project default; picking one pins it for this session
  // only.
  const [chosenKind, setChosenKind] = useState<"" | WorkspaceKind>("");
  // "" defers to the project's base branch, which is what the placeholder in
  // the field says it will do.
  const [baseRef, setBaseRef] = useState("");
  const [listing, setListing] = useState<WorkspaceListing>({
    workspaces: [],
    issues: [],
    issuesError: "",
  });
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const instances = pickerInstances(harnesses);
  // Until the user picks, the project's defaults decide — and where it has
  // none, the first account that could actually start a session.
  const fallbackHarness =
    project?.config.defaults.harness ||
    harnesses.find((h) => h.availability.state === "ready")?.id ||
    harnesses[0]?.id ||
    "";
  const instance =
    (chosen && instances.find((i) => i.id === chosen.instance)) ??
    resolveInstance(instances, "", fallbackHarness);
  const harnessId = instance?.driver ?? fallbackHarness;
  const selected = harnesses.find((h) => h.id === harnessId);
  // A model the account no longer offers is not sent: the harness's own
  // default is a better answer than a name it has stopped serving.
  const preferred = chosen?.model || (chosen ? "" : (project?.config.defaults.model ?? ""));
  const model = instance?.models.some((m) => m.id === preferred)
    ? preferred
    : (defaultModel(instance)?.id ?? "");
  const selection: ModelSelection = {
    harness: harnessId,
    instance: instance?.id ?? "",
    model,
  };
  // Modes are the selected harness's own presets, repopulated when the harness
  // changes — the same shape as the model picker. Only an expressed preference
  // (picked here, or a project default) is sent; otherwise the mode stays ""
  // so the harness's own configured default wins rather than being overridden
  // by an explicit id.
  const modes = selected?.permissionModes ?? [];
  const mode = modes.some((m) => m.id === chosenMode)
    ? chosenMode
    : modes.some((m) => m.id === project?.config.defaults.mode)
      ? (project?.config.defaults.mode ?? "")
      : "";
  const displayModeId = mode || (modes.find((m) => m.default)?.id ?? modes[0]?.id ?? "");
  const modeMeta = modes.find((m) => m.id === displayModeId);
  // The project root is its own choice in the list, so listing it again inside
  // the attach picker would be a second door to the same room. Its busy flag
  // still matters — it is what the warning under the choice is made of.
  const root = listing.workspaces.find((w) => w.isRoot);
  const rootBusy = !!root?.busy;
  const attachable = listing.workspaces.filter((w) => !w.isRoot);
  const kind: WorkspaceKind =
    chosenKind || (project?.config.defaults.workspace === "managed" ? "branch" : "main");

  // Each choice answers all three questions at once, which is the point of
  // making them separate choices: nothing is inferred from an empty field.
  const branch = kind === "branch" ? choice.branch.trim() : "";
  const workspace = kind === "main" ? "local" : kind === "attach" ? "" : "managed";
  const workspacePath = kind === "attach" ? choice.attachPath : "";
  // A base only means anything where hy is the one creating the branch.
  const sentBase = kind === "branch" || kind === "scratch" ? baseRef.trim() : "";
  // Branches already on disk are the useful bases — stacking on another
  // worktree's work is exactly what this field exists for.
  const baseSuggestions = Array.from(
    new Set(
      [project?.config.defaults.baseBranch, ...listing.workspaces.map((w) => w.branch)].filter(
        (b): b is string => !!b,
      ),
    ),
  );
  // A choice that names nothing yet cannot start: "scratch" is the option for
  // people who do not want to name anything.
  const canStart = kind === "branch" ? !!branch : kind === "attach" ? !!choice.attachPath : true;
  const ready =
    status === "online" && !!project && instance?.availability?.state === "ready" && canStart;

  const create = async () => {
    if (!project) return;
    // A danger mode needs a deliberate second step before anything starts.
    if (
      modeMeta?.danger &&
      !window.confirm(
        `Start this session in "${modeMeta.label}"?\n\n${modeMeta.description ?? ""}\n\nThe agent will act without asking you first.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        projectId: project.id,
        harness: harnessId,
        instance: instance?.id ?? "",
        model,
        mode,
        branch,
        workspace,
        workspacePath,
        baseRef: sentBase,
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
    setChosenKind("");
    setBaseRef("");
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
      {/* A phone gets the whole screen: this is a task, not an aside, and a
          centred card on a 390px viewport is a card with no margins anyway.
          Header and footer stay put; only the form between them scrolls, so
          "Start" is never scrolled off the bottom. */}
      <DialogContent
        fullscreenOnMobile
        className="flex max-h-[min(85dvh,44rem)] flex-col gap-0 p-0 md:max-w-md"
      >
        <DialogHeader className="px-6 py-4 pt-[calc(1rem+env(safe-area-inset-top))] pr-16 text-left md:pt-4 md:pr-6">
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            Pick a project. Hy prepares its workspace before starting the agent.
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pt-1 pb-5">

        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <p className="text-muted-foreground text-[13px]">
              Add a project once, then create every session from here.
            </p>
            <Button className="mt-4" onClick={onAddProject}>
              <PlusIcon />
              Add project
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-session-project">Project</Label>
              <div className="flex gap-2">
                <Select
                  value={project?.id}
                  onValueChange={(v) => {
                    setProjectId(v);
                    setChosen(null);
                    setChosenMode("");
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

            <div className="space-y-1.5">
              <Label htmlFor="new-session-model">Model</Label>
              {/* Harness and model in one control: choosing a model already
                  chooses the account it runs under, and a session cannot have
                  one without the other. */}
              <ModelPicker
                id="new-session-model"
                harnesses={harnesses}
                value={selection}
                onChange={setChosen}
              />
            </div>

            {instance && instance.availability?.state !== "ready" && (
              <Alert>
                <AlertDescription>
                  <span>{instance.availability?.reason}</span>
                  <Button variant="outline" size="sm" className="mt-2" onClick={onRecheck}>
                    <RefreshCwIcon />
                    Check again
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {modes.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="new-session-mode">Permissions</Label>
                {/* Modes all render alike: the description below says what each
                    one does, and the confirm on create is where a danger mode
                    earns its extra step. Colouring the control adds nothing. */}
                <Select value={displayModeId} onValueChange={setChosenMode}>
                  <SelectTrigger id="new-session-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modes.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {modeMeta?.description && (
                  <p className="text-muted-foreground text-[11px]">{modeMeta.description}</p>
                )}
              </div>
            )}

            <fieldset className="space-y-1.5">
              <legend className="text-foreground mb-1.5 text-sm leading-none font-medium">
                Workspace
              </legend>
              {/* One list, one choice, and every scenario has a row of its
                  own. The old two-button toggle left three of them hiding
                  inside a text field that meant something different depending
                  on what you did to it. */}
              <div role="radiogroup" aria-label="Workspace" className="flex flex-col gap-1.5">
                {WORKSPACE_KINDS.map((k) => {
                  const picked = kind === k.id;
                  return (
                    <button
                      key={k.id}
                      type="button"
                      role="radio"
                      aria-checked={picked}
                      onClick={() => {
                        setChosenKind(k.id);
                        // Each choice asks its own question, so it starts from
                        // a blank answer rather than inheriting the last
                        // one's — a branch name is not a worktree path.
                        setChoice({ branch: "", attachPath: "" });
                      }}
                      className={cn(
                        "focus-visible:ring-ring flex min-h-11 flex-col justify-center gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2",
                        picked ? "border-primary/60 bg-primary/10" : "hover:bg-accent/50",
                      )}
                    >
                      <span className="text-[13px] leading-tight">{k.label}</span>
                      <span className="text-muted-foreground truncate text-[11px] leading-tight">
                        {k.id === "main" ? (project?.root ?? k.hint) : k.hint}
                      </span>
                    </button>
                  );
                })}
              </div>

              {kind === "main" && (
                <div className="pt-1">
                  {/* The one mode where an agent edits the user's own files, so
                      it says so plainly rather than leaving it to be
                      inferred. */}
                  <p className="text-muted-foreground text-[11px]">
                    The agent works directly in {project?.root} on its current branch. No worktree
                    is created and nothing is removed when the session ends.
                  </p>
                  {rootBusy && (
                    // Inline, not a modal and not a browser dialog: it is a
                    // fact about the choice, and the answer is still yes.
                    <p className="text-attention-foreground mt-1.5 text-[11px]">
                      “{root?.busyTitle}” is already on the main checkout — agents may step on each
                      other.
                    </p>
                  )}
                </div>
              )}

              {kind === "branch" && (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="new-session-workspace">Branch</Label>
                  <WorkspacePicker
                    id="new-session-workspace"
                    mode="create"
                    value={choice}
                    onChange={setChoice}
                    workspaces={attachable}
                    issues={listing.issues}
                    issuesError={listing.issuesError}
                    userConfig={userConfig}
                    loading={loadingSpaces}
                    placeholder="issue/482-fix-login"
                  />
                </div>
              )}

              {kind === "scratch" && (
                <p className="text-muted-foreground pt-1 text-[11px]">
                  hy names the branch and the directory. Nothing to fill in.
                </p>
              )}

              {kind === "attach" && (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="new-session-attach">Worktree</Label>
                  <WorkspacePicker
                    id="new-session-attach"
                    mode="attach"
                    value={choice}
                    onChange={setChoice}
                    workspaces={attachable}
                    issues={listing.issues}
                    issuesError={listing.issuesError}
                    userConfig={userConfig}
                    loading={loadingSpaces}
                    placeholder="Search worktrees"
                  />
                </div>
              )}

              {(kind === "branch" || kind === "scratch") && (
                <div className="space-y-1.5 pt-2">
                  <Label htmlFor="new-session-base">Base</Label>
                  {/* A per-session base is what makes stacking possible: a
                      worktree branched from another branch that has not landed
                      yet. Free text, because any ref is a legal answer, with
                      the branches already on disk offered as the likely
                      ones. */}
                  <Input
                    id="new-session-base"
                    list="new-session-base-options"
                    value={baseRef}
                    onChange={(e) => setBaseRef(e.target.value)}
                    placeholder={project?.config.defaults.baseBranch || "HEAD"}
                    className="w-full text-[16px] md:text-[13px]"
                  />
                  <datalist id="new-session-base-options">
                    {baseSuggestions.map((b) => (
                      <option key={b} value={b} />
                    ))}
                  </datalist>
                  <p className="text-muted-foreground text-[11px]">
                    The new branch starts here. Leave it empty for the project default
                    {project?.config.defaults.baseBranch
                      ? ` (${project.config.defaults.baseBranch})`
                      : ""}
                    .
                  </p>
                </div>
              )}
            </fieldset>
          </div>
        )}

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription className="font-mono text-[11px]">{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="border-t px-6 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-4">
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
