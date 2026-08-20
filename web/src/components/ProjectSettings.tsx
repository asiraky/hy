import { FileIcon, FolderIcon, FolderOpenIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";

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
import { Separator } from "~/components/ui/separator";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";
import type { HarnessMeta, Issue, Project, ProjectConfig, UserConfig } from "~/protocol";
import { makeFormatter } from "./WorkspacePicker";

// A stand-in issue, so the preview shows a real answer rather than describing one.
const sampleIssue: Issue = {
  number: 482,
  title: "Token refresh 500s after 24h",
  url: "",
  labels: [{ name: "bug" }],
};

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/** A section heading, so every group on this screen has the same weight. */
function SectionHeading({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <h3 className="text-[12px] font-medium">
      {children}
      {note && <span className="text-muted-foreground font-normal"> · {note}</span>}
    </h3>
  );
}

/**
 * The branch-name function is the operator's own habit, not the project's, so
 * it saves to ~/.hy/config.json even though it is edited on this screen.
 */
function BranchFormatField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  const preview = useMemo(() => {
    const { format, error } = makeFormatter(value);
    if (error) return { text: error, bad: true };
    const out = format(sampleIssue);
    return out
      ? { text: out, bad: false }
      : { text: "function returned nothing for the sample issue", bad: true };
  }, [value]);

  return (
    <div className="space-y-1.5">
      <SectionHeading note="this machine only">Branch names from issues</SectionHeading>
      <p className="text-muted-foreground text-[11px]">
        A JavaScript function, issue in and branch name out. It names the worktrees suggested from
        your open GitHub issues.
      </p>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={4}
        className="scroll-thin font-mono text-[11px]"
      />
      <p
        className={cn(
          "font-mono text-[11px] break-all",
          preview.bad ? "text-attention-foreground" : "text-muted-foreground",
        )}
      >
        #{sampleIssue.number} → {preview.text}
      </p>
    </div>
  );
}

interface Listing {
  path: string;
  parent: string;
  dirs: string[];
  files: string[];
}

function HookField({
  label,
  root,
  value,
  onChange,
}: {
  label: string;
  root: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<Listing | null>(null);

  const load = async (path: string) => {
    const r = await fetch(
      `/api/fs?path=${encodeURIComponent(path)}&root=${encodeURIComponent(root)}&files=1`,
    );
    if (r.ok) setListing((await r.json()) as Listing);
  };
  const choose = (path: string) => {
    onChange(path.slice(root.replace(/\/$/, "").length + 1));
    setOpen(false);
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`scripts/hy-${label.toLowerCase()}`}
          className="min-w-0 flex-1 font-mono text-[12px]"
        />
        <Button
          variant="outline"
          onClick={() => {
            setOpen(!open);
            if (!open) void load(root);
          }}
        >
          <FolderOpenIcon />
          {open ? "Done" : "Choose…"}
        </Button>
      </div>

      {open && listing && (
        <div className="scroll-thin max-h-44 overflow-y-auto rounded-lg border">
          {listing.path !== root && (
            <button
              type="button"
              onClick={() => void load(listing.parent)}
              className="hover:bg-accent text-muted-foreground flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px]"
            >
              <FolderIcon className="size-3.5 shrink-0" />
              ../
            </button>
          )}
          {listing.dirs.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => void load(`${listing.path}/${d}`)}
              className="hover:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px]"
            >
              <FolderIcon className="size-3.5 shrink-0" />
              {d}/
            </button>
          ))}
          {listing.files.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => choose(`${listing.path}/${f}`)}
              className="hover:bg-accent text-primary flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px]"
            >
              <FileIcon className="size-3.5 shrink-0" />
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectSettings({
  project,
  defaultRoot,
  harnesses,
  userConfig,
  onAdd,
  onSave,
  onSaveUserConfig,
  onClose,
}: {
  project: Project | null;
  defaultRoot: string;
  harnesses: HarnessMeta[];
  userConfig: UserConfig | null;
  onAdd: (root: string) => Promise<void>;
  onSave: (id: string, cfg: ProjectConfig) => Promise<void>;
  onSaveUserConfig: (cfg: UserConfig) => Promise<void>;
  onClose: () => void;
}) {
  const [root, setRoot] = useState(project?.root ?? defaultRoot);
  const [cfg, setCfg] = useState<ProjectConfig>(
    project?.config ?? {
      version: 1,
      name: "",
      defaults: { harness: "codex", workspace: "local" },
      workspace: {
        suggestedRoot: ".worktrees",
        provisionTimeoutSeconds: 1800,
        deprovisionTimeoutSeconds: 600,
      },
    },
  );
  const [user, setUser] = useState<UserConfig>(userConfig ?? { version: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (project) {
        await onSave(project.id, cfg);
        await onSaveUserConfig(user);
      } else await onAdd(root);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const defaults = (patch: Partial<ProjectConfig["defaults"]>) =>
    setCfg({ ...cfg, defaults: { ...cfg.defaults, ...patch } });
  const workspace = (patch: Partial<ProjectConfig["workspace"]>) =>
    setCfg({ ...cfg, workspace: { ...cfg.workspace, ...patch } });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Header and footer stay put; only the form between them scrolls. */}
      <DialogContent className="flex max-h-[min(90dvh,44rem)] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{project ? `${cfg.name} settings` : "Add project"}</DialogTitle>
          <DialogDescription>
            {project
              ? "Defaults every new session in this project starts from."
              : "Point hy at a Git checkout to start creating sessions in it."}
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {!project ? (
            <div className="space-y-1.5">
              <Label htmlFor="project-root">Project directory</Label>
              <Input
                id="project-root"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                className="font-mono text-[12px]"
              />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="project-name">Project name</Label>
                <Input
                  id="project-name"
                  value={cfg.name}
                  onChange={(e) => setCfg({ ...cfg, name: e.target.value })}
                />
                <p className="text-muted-foreground font-mono text-[10px] break-all">
                  {project.root}/.hy/project.json
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <SectionHeading>Agent defaults</SectionHeading>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Select
                    value={cfg.defaults.harness ?? ""}
                    onValueChange={(v) => defaults({ harness: v })}
                  >
                    <SelectTrigger aria-label="Default harness" className="w-full">
                      <SelectValue placeholder="Harness" />
                    </SelectTrigger>
                    <SelectContent>
                      {harnesses.map((h) => (
                        <SelectItem key={h.id} value={h.id}>
                          {h.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    value={cfg.defaults.model ?? ""}
                    onChange={(e) => defaults({ model: e.target.value })}
                    placeholder="Default model"
                    aria-label="Default model"
                  />

                  {/* Radix rejects "" as a value, so the unset case is a named
                    sentinel that maps back to "" on the way out. */}
                  <Select
                    value={cfg.defaults.effort || "default"}
                    onValueChange={(v) => defaults({ effort: v === "default" ? "" : v })}
                  >
                    <SelectTrigger aria-label="Default effort" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default effort</SelectItem>
                      {EFFORTS.map((e) => (
                        <SelectItem key={e} value={e}>
                          {e}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Modes belong to the default harness; the list follows it. */}
                  <Select
                    value={cfg.defaults.mode || "default"}
                    onValueChange={(v) => defaults({ mode: v === "default" ? "" : v })}
                  >
                    <SelectTrigger aria-label="Default permission mode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default permissions</SelectItem>
                      {(() => {
                        const modes =
                          harnesses.find((h) => h.id === (cfg.defaults.harness ?? ""))
                            ?.permissionModes ?? [];
                        const items = modes.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.label}
                          </SelectItem>
                        ));
                        // A saved mode the current harness list does not know
                        // still renders, verbatim, rather than vanishing.
                        if (cfg.defaults.mode && !modes.some((m) => m.id === cfg.defaults.mode)) {
                          items.push(
                            <SelectItem key={cfg.defaults.mode} value={cfg.defaults.mode}>
                              {cfg.defaults.mode}
                            </SelectItem>,
                          );
                        }
                        return items;
                      })()}
                    </SelectContent>
                  </Select>

                  <Select
                    value={cfg.defaults.workspace ?? "local"}
                    onValueChange={(v) => defaults({ workspace: v })}
                  >
                    <SelectTrigger aria-label="Default workspace" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local">Use project directory</SelectItem>
                      <SelectItem value="managed">Managed worktree</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <SectionHeading>Workspace</SectionHeading>
                <div className="space-y-1.5">
                  <Label htmlFor="base-branch">Base branch</Label>
                  <Input
                    id="base-branch"
                    value={cfg.defaults.baseBranch ?? ""}
                    onChange={(e) => defaults({ baseBranch: e.target.value })}
                    placeholder="main"
                    className="font-mono text-[12px]"
                  />
                </div>
                <HookField
                  label="Provision"
                  root={project.root}
                  value={cfg.workspace.provision ?? ""}
                  onChange={(v) => workspace({ provision: v })}
                />
                <HookField
                  label="Deprovision"
                  root={project.root}
                  value={cfg.workspace.deprovision ?? ""}
                  onChange={(v) => workspace({ deprovision: v })}
                />
              </div>

              <Separator />

              <BranchFormatField
                value={user.branchFormat ?? ""}
                onChange={(v) => setUser({ ...user, branchFormat: v })}
              />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription className="font-mono text-[11px] break-words">
                {error}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || (!project && !root)} onClick={save}>
            {busy ? "Saving…" : project ? "Save" : "Add project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
