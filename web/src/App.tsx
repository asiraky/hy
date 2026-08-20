import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Client, wsURL, type ConnectionStatus } from "./client";
import { useIsDesktop } from "./useMediaQuery";
import type { Access, FileDiff, HarnessMeta, Project, ProjectConfig, SessionChanges, SessionMeta, SessionState, UserConfig } from "./protocol";
import { AccessPanel } from "./components/Access";
import { Changes } from "./components/Changes";
import { Composer } from "./components/Composer";
import { NewSession } from "./components/NewSession";
import type { NewSessionInput } from "./components/NewSession";
import { ProjectSettings } from "./components/ProjectSettings";
import { PermissionPrompt } from "./components/PermissionPrompt";
import { ElicitationPrompt } from "./components/ElicitationPrompt";
import { Sidebar } from "./components/Sidebar";
import { Transcript } from "./components/Transcript";
import { IconButton } from "./components/IconButton";
import { ThemePreview } from "./components/ThemePreview";
import { Button } from "./components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { cn } from "./lib/utils";
import { FileDiffIcon, PanelLeftIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { toast } from "sonner";

const LAST_SESSION = "hy.lastSession";

// The permission-mode switcher is parked, not removed: changing modes mid-chat
// is not something we want to offer right now, and hiding it is cheaper to
// reverse than deleting it. Flip this to bring it back.
const SHOW_MODE_SWITCHER = false;

export function App() {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [harnesses, setHarnesses] = useState<HarnessMeta[]>([]);
  const [defaultCwd, setDefaultCwd] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const isDesktop = useIsDesktop();
  // Open is the desktop default; on a phone the drawer starts closed so the
  // transcript is what you land on. Crossing the breakpoint resets it.
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop);
  useEffect(() => setSidebarOpen(isDesktop), [isDesktop]);
  const [creating, setCreating] = useState(false);
  const [projectSettings, setProjectSettings] = useState<Project | "add" | null>(null);
  const [userConfig, setUserConfig] = useState<UserConfig | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [showAccess, setShowAccess] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  // One click takes the diff panel to the full content width; another brings
  // it back. There is no in-between state on purpose.
  const [changesExpanded, setChangesExpanded] = useState(false);
  // The theme sample page: a static mock of the dashboard behind a palette
  // switcher, reachable at #themes so it needs no router.
  const [themePreview, setThemePreview] = useState(() => window.location.hash === "#themes");
  useEffect(() => {
    const onHash = () => setThemePreview(window.location.hash === "#themes");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // Which file the changes panel should reveal, and a counter that changes on
  // every request. Without the counter, asking for the same file twice would
  // look identical to the panel and it would not scroll back to it.
  const [reveal, setReveal] = useState<{ path: string; nonce: number } | null>(null);

  // Opening the diff from a turn's card: show the panel, and put it on the file
  // that was clicked.
  const openDiff = useCallback((path?: string) => {
    setShowChanges(true);
    if (path) setReveal((current) => ({ path, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  const clientRef = useRef<Client | null>(null);
  const forcePromptedRef = useRef<string | null>(null);

  // The socket callbacks below outlive any single render, so they read the
  // attached session from a ref rather than a captured closure. The ref is
  // written after commit, never during render, so it can only ever hold a
  // value the UI actually rendered.
  const activeRef = useRef<string | null>(activeId);
  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    const client = new Client(wsURL(), {
      onStatus: setStatus,
      onSessions: setSessions,
      onHarnesses: (h, cwd) => {
        setHarnesses(h);
        // A harness-only push carries no cwd; keep the one the welcome frame
        // established rather than blanking it.
        if (cwd) setDefaultCwd(cwd);
      },
      onProjects: setProjects,
      // State only lands for the session currently attached; the client
      // discards anything else.
      onState: (id, s) => {
        if (id === activeRef.current) setState(s);
      },
      onAccess: setAccess,
    });
    clientRef.current = client;
    client.connect();
    return () => client.close();
  }, []);

  // User-scope preferences are read once the socket is up, and again after a
  // reconnect only if we never got them; they change far less often than state.
  useEffect(() => {
    if (status !== "online" || userConfig) return;
    clientRef.current?.command("get_user_config", {}).then(res => setUserConfig(res.userConfig)).catch(() => {});
  }, [status, userConfig]);

  // Restore the last session once the list arrives.
  useEffect(() => {
    if (activeId || sessions.length === 0) return;
    const last = localStorage.getItem(LAST_SESSION);
    const pick = sessions.find((s) => s.id === last && s.phase !== "closed") ?? null;
    if (pick) select(pick.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  const select = useCallback(
    (id: string) => {
      setActiveId(id);
      activeRef.current = id;
      // The panel belongs to a checkout, so it must not survive a move to a
      // different one.
      setShowChanges(false);
      setChangesExpanded(false);
      // A file asked for in one session means nothing in the next, and another
      // session holding the same path would otherwise open it unasked.
      setReveal(null);
      setState(null);
      localStorage.setItem(LAST_SESSION, id);
      clientRef.current?.attach(id);
      if (!isDesktop) setSidebarOpen(false);
    },
    [isDesktop],
  );

  const startNew = useCallback(() => {
    setCreating(true);
    if (!isDesktop) setSidebarOpen(false);
  }, [isDesktop]);

  const create = useCallback(
    async (input: NewSessionInput) => {
      const res = await clientRef.current!.command("create_session", input);
      setCreating(false);
      select(res.sessionId);
    },
    [select],
  );

  const listWorkspaces = useCallback(async (projectId: string) => {
    const res = await clientRef.current!.command("list_workspaces", { projectId });
    return { workspaces: res.workspaces ?? [], issues: res.issues ?? [], issuesError: res.issuesError ?? "" };
  }, []);
  const saveUserConfig = useCallback(async (cfg: UserConfig) => { const res=await clientRef.current!.command("save_user_config",{config:cfg}); setUserConfig(res.userConfig); },[]);

  const addProject = useCallback(async (root: string) => { const res=await clientRef.current!.command("add_project",{root}); setProjects(p=>[res.project,...p.filter(x=>x.id!==res.project.id)]); },[]);
  const saveProject = useCallback(async (projectId:string,config:ProjectConfig) => { const res=await clientRef.current!.command("save_project",{projectId,config}); setProjects(p=>p.map(x=>x.id===projectId?res.project:x)); },[]);

  // Git is the source of truth for what a session changed: it catches the
  // formatter and the codemod as well as the edits we parsed out of tool calls.
  const loadChanges = useCallback(async () => {
    const res = await clientRef.current!.command("session_changes", { sessionId: activeId });
    return res.changes as SessionChanges;
  }, [activeId]);

  const loadFileDiff = useCallback(
    async (path: string) => {
      const res = await clientRef.current!.command("session_file_diff", { sessionId: activeId, path });
      return res.diff as FileDiff;
    },
    [activeId],
  );

  const send = useCallback(
    (text: string) => {
      if (!activeId) return;
      clientRef.current?.command("prompt", { sessionId: activeId, text }).catch((e) => {
        toast.error("Could not send that prompt", { description: e.message });
      });
    },
    [activeId],
  );

  const cancel = useCallback(() => {
    if (activeId) clientRef.current?.command("cancel", { sessionId: activeId });
  }, [activeId]);

  const resolvePermission = useCallback(
    (requestId: string, outcome: string, optionId: string) => {
      if (activeId) {
        clientRef.current?.command("resolve_permission", {
          sessionId: activeId,
          requestId,
          outcome,
          optionId,
        });
      }
    },
    [activeId],
  );

  const resolveElicitation = useCallback(
    (requestId: string, action: string, value: unknown) => {
      if (activeId) {
        clientRef.current?.command("resolve_elicitation", {
          sessionId: activeId,
          requestId,
          action,
          value,
        });
      }
    },
    [activeId],
  );

  const remove = useCallback(
    (id: string) => {
      if (id !== activeRef.current) select(id);
      clientRef.current?.command("delete_session", { sessionId: id }).catch((e) => {
        toast.error("Could not delete that session", { description: e.message });
      });
    },
    [select],
  );

  const forceDelete = useCallback((id: string) => {
    const accepted = window.confirm("Tear down failed. Would you like to force delete?\n\nThis skips the teardown script, removes the recorded Git worktree, and permanently deletes the session.");
    if (!accepted) return;
    clientRef.current?.command("force_delete_session", { sessionId: id }).catch((e) => toast.error("Force delete failed", { description: e.message }));
  }, []);

  // Ask the server to re-probe, for when the user has just installed something.
  const recheck = useCallback(() => {
    clientRef.current?.command("recheck_harnesses", {}).then((res) => {
      if (res?.harnesses) setHarnesses(res.harnesses);
    });
  }, []);

  const meta = useMemo(() => sessions.find((s) => s.id === activeId), [sessions, activeId]);

  // The permission modes for the attached session's harness. Everything the UI
  // knows about them came from the adapter via the server; ids stay opaque.
  const modeOptions = useMemo(
    () => harnesses.find((h) => h.id === state?.harness)?.permissionModes ?? [],
    [harnesses, state?.harness],
  );
  // An empty recorded mode means the harness default; render it as such.
  const currentModeId =
    (modeOptions.some((m) => m.id === state?.mode) ? state?.mode : undefined) ??
    modeOptions.find((m) => m.default)?.id ??
    modeOptions[0]?.id ??
    "";

  const switchMode = useCallback(
    (modeId: string) => {
      if (!activeId) return;
      const m = modeOptions.find((x) => x.id === modeId);
      if (
        m?.danger &&
        !window.confirm(
          `Switch this session to "${m.label}"?\n\n${m.description ?? ""}\n\nThe agent will act without asking you first.`,
        )
      ) {
        return;
      }
      clientRef.current?.command("set_mode", { sessionId: activeId, mode: modeId }).catch((e) => {
        toast.error("Could not switch permission mode", { description: e.message });
      });
    },
    [activeId, modeOptions],
  );
  const accentOf = useCallback(
    (id: string) => harnesses.find((h) => h.id === id)?.accent,
    [harnesses],
  );

  const switchModel = useCallback(
    (modelId: string) => {
      if (!activeId) return;
      clientRef.current?.command("set_model", { sessionId: activeId, model: modelId }).catch((e) => {
        toast.error("Could not switch model", { description: e.message });
      });
    },
    [activeId],
  );
  const pending = state?.pendingPermissions?.[0];
  const elicitation = state?.pendingElicitations?.[0];
  const activeProject = projects.find((p) => p.id === meta?.projectId);
  const workspaceBusy = state ? ["creating","provisioning","cleaning"].includes(state.phase) : false;
  const workspaceFailed = state ? ["provision_failed","cleanup_failed"].includes(state.phase) : false;

  useEffect(() => {
    if (!activeId || state?.phase !== "cleanup_failed" || !state.workspace.deleteAfterCleanup) return;
    const key = `${activeId}:${state.seq}`;
    if (forcePromptedRef.current === key) return;
    forcePromptedRef.current = key;
    forceDelete(activeId);
  }, [activeId, state, forceDelete]);

  useEffect(() => {
    if (!activeId || !state || sessions.some((s) => s.id === activeId)) return;
    setActiveId(null); setState(null); clientRef.current?.detach();
  }, [sessions, activeId, state]);

  if (themePreview) return <ThemePreview />;

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        status={status}
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        onSelect={select}
        onNew={startNew}
        onDelete={remove}
        onShowAccess={() => setShowAccess(true)}
        accentOf={accentOf}
        projectName={(id)=>projects.find(p=>p.id===id)?.config.name}
      />

      <main
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          // The expanded diff panel takes the whole content area; the main
          // column stays mounted so the transcript keeps its scroll and state.
          showChanges && changesExpanded && "hidden",
        )}
      >
        <header className="flex items-center gap-2 px-2 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-2 md:px-3">
          {/* The open sidebar carries its own collapse button, so this one
              only appears when there is a closed sidebar to reopen. */}
          <IconButton
            label="Show sessions"
            onClick={() => setSidebarOpen(true)}
            className={cn(sidebarOpen && "md:hidden")}
          >
            <PanelLeftIcon />
          </IconButton>

          {state ? (
            <>
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {state.title || "Untitled session"}
              </p>

              {SHOW_MODE_SWITCHER && modeOptions.length > 0 && !state.closed && (
                <Select value={currentModeId} onValueChange={switchMode}>
                  {/* Every mode gets the same chip: one that changed shape or
                      colour by mode would jitter the header and shout at the
                      user about a choice they already made deliberately. */}
                  <SelectTrigger
                    aria-label="Permission mode"
                    className="h-8 w-auto shrink-0 gap-1 px-2 text-[11px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modeOptions.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <IconButton
                label={showChanges ? "Hide changed files" : "Show changed files"}
                onClick={() => setShowChanges((v) => !v)}
                className={cn(showChanges && "bg-accent")}
              >
                <FileDiffIcon />
              </IconButton>

              {activeProject && (
                <IconButton
                  label={`${activeProject.config.name} settings`}
                  onClick={() => setProjectSettings(activeProject)}
                >
                  <SettingsIcon />
                </IconButton>
              )}

            </>
          ) : (
            <span className="text-muted-foreground flex-1 text-[13px]">
              {meta ? "Attaching…" : "No session selected"}
            </span>
          )}
        </header>

        {state ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* Content scrolling up dissolves into the header rather than
                being cut by a border. */}
            <div className="from-background pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b to-transparent" />

            <Transcript state={state} onContinue={()=>activeId&&clientRef.current?.command("continue_session",{sessionId:activeId})} onRetryProvision={()=>activeId&&clientRef.current?.command("retry_provision",{sessionId:activeId})} onCleanup={()=>activeId&&clientRef.current?.command("cleanup_session",{sessionId:activeId})} onForceDelete={()=>activeId&&forceDelete(activeId)} onOpenDiff={openDiff} />

            {/* The input floats over the transcript's tail instead of sitting
                in a full-width tray. Anything that blocks the turn — a
                permission or elicitation — stacks above it. */}
            <div className="absolute inset-x-0 bottom-0 z-10">
              {pending && (
                <PermissionPrompt
                  request={pending}
                  onResolve={(outcome, optionId) =>
                    resolvePermission(pending.requestId, outcome, optionId)
                  }
                />
              )}

              {elicitation && (
                <ElicitationPrompt
                  request={elicitation}
                  onResolve={(action, value) => resolveElicitation(elicitation.requestId, action, value)}
                />
              )}

              <Composer
                disabled={state.closed || workspaceBusy || workspaceFailed}
                disabledPlaceholder={workspaceBusy ? (state.phase === "cleaning" ? "Cleaning up workspace…" : "Preparing workspace…") : workspaceFailed ? "Workspace needs attention" : undefined}
                busy={state.phase === "turn"}
                onSend={send}
                onCancel={cancel}
                harnesses={harnesses}
                harness={state.harness}
                instance={meta?.providerInstance ?? ""}
                model={state.model}
                effort={state.effort}
                onSwitchModel={switchModel}
                contextPct={state.usage.contextPct}
                contextUsed={state.usage.contextUsed}
                contextWindow={state.usage.contextWindow}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
            <div>
              <p className="font-mono text-3xl font-semibold tracking-tight">hy</p>
              <p className="text-muted-foreground mt-2 text-[13px]">
                One server, several harnesses, any number of screens.
              </p>
            </div>
            <Button size="lg" onClick={startNew}>
              <PlusIcon />
              New session
            </Button>
          </div>
        )}
      </main>

      {state && activeId && (
        <Changes
          open={showChanges}
          onClose={() => { setShowChanges(false); setChangesExpanded(false); }}
          expanded={changesExpanded}
          onToggleExpanded={() => setChangesExpanded((v) => !v)}
          // The worktree is worth re-reading when the agent stops writing to it.
          revision={`${activeId}:${state.phase === "turn" ? "turn" : "settled"}`}
          loadChanges={loadChanges}
          loadDiff={loadFileDiff}
          reveal={reveal}
        />
      )}

      {showAccess && access && (
        <AccessPanel
          access={access}
          onEnableHTTPS={async () => {
            const res = await clientRef.current!.command("enable_https", {});
            if (res?.access) setAccess(res.access);
          }}
          onDisableHTTPS={async () => {
            const res = await clientRef.current!.command("disable_https", {});
            if (res?.access) setAccess(res.access);
          }}
          onClose={() => setShowAccess(false)}
        />
      )}

      {creating && (
        <NewSession
          projects={projects}
          harnesses={harnesses}
          userConfig={userConfig}
          onCreate={create}
          onListWorkspaces={listWorkspaces}
          onAddProject={()=>setProjectSettings("add")}
          onSettings={setProjectSettings}
          onRecheck={recheck}
          status={status}
          onClose={() => setCreating(false)}
        />
      )}
      {projectSettings && (
        <ProjectSettings
          project={projectSettings === "add" ? null : projectSettings}
          defaultRoot={defaultCwd}
          harnesses={harnesses}
          userConfig={userConfig}
          onAdd={addProject}
          onSave={saveProject}
          onSaveUserConfig={saveUserConfig}
          onClose={() => setProjectSettings(null)}
        />
      )}
    </div>
  );
}
