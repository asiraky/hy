import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Client, wsURL, type ConnectionStatus } from "./client";
import { useIsDesktop } from "./useMediaQuery";
import type { Access, HarnessMeta, Project, ProjectConfig, SessionMeta, SessionState, UserConfig } from "./protocol";
import { AccessPanel } from "./components/Access";
import { Composer } from "./components/Composer";
import { NewSession } from "./components/NewSession";
import type { NewSessionInput } from "./components/NewSession";
import { ProjectSettings } from "./components/ProjectSettings";
import { PermissionPrompt } from "./components/PermissionPrompt";
import { ElicitationPrompt } from "./components/ElicitationPrompt";
import { Sidebar } from "./components/Sidebar";
import { Transcript } from "./components/Transcript";
import { Button, HarnessBadge, StatusDot } from "./components/ui";

const LAST_SESSION = "hy.lastSession";

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
        setDefaultCwd(cwd);
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

  const send = useCallback(
    (text: string) => {
      if (!activeId) return;
      clientRef.current?.command("prompt", { sessionId: activeId, text }).catch((e) => {
        console.warn("prompt failed:", e.message);
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
        console.warn("delete failed:", e.message);
      });
    },
    [select],
  );

  const forceDelete = useCallback((id: string) => {
    const accepted = window.confirm("Tear down failed. Would you like to force delete?\n\nThis skips the teardown script, removes the recorded Git worktree, and permanently deletes the session.");
    if (!accepted) return;
    clientRef.current?.command("force_delete_session", { sessionId: id }).catch((e) => window.alert(`Force delete failed: ${e.message}`));
  }, []);

  // Ask the server to re-probe, for when the user has just installed something.
  const recheck = useCallback(() => {
    clientRef.current?.command("recheck_harnesses", {}).then((res) => {
      if (res?.harnesses) setHarnesses(res.harnesses);
    });
  }, []);

  const meta = useMemo(() => sessions.find((s) => s.id === activeId), [sessions, activeId]);
  const accentOf = useCallback(
    (id: string) => harnesses.find((h) => h.id === id)?.accent,
    [harnesses],
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

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        status={status}
        open={sidebarOpen}
        onSelect={select}
        onNew={startNew}
        onDelete={remove}
        accentOf={accentOf}
        projectName={(id)=>projects.find(p=>p.id===id)?.config.name}
      />

      {/* The drawer overlays content on small screens, so it needs a way out
          that does not require finding the toggle again. */}
      {sidebarOpen && (
        <div
          aria-hidden
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-ink-800 px-4 pt-[calc(0.625rem+env(safe-area-inset-top))] pb-2.5">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded text-ink-500 hover:bg-ink-850 hover:text-ink-100 md:-ml-1 md:size-8"
            title="Toggle sidebar"
          >
            ☰
          </button>

          {state ? (
            <>
              <HarnessBadge harness={state.harness} accent={accentOf(state.harness)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">{state.title || "Untitled session"}</p>
                <p className="truncate font-mono text-[10px] text-ink-500">
                  {state.cwd}
                  {state.model && ` · ${state.model}`}
                </p>
              </div>

              {state.usage.output > 0 && (
                <span className="hidden font-mono text-[10px] text-ink-500 sm:block">
                  {state.usage.input.toLocaleString()} in / {state.usage.output.toLocaleString()} out
                  {state.usage.cost > 0 && ` · $${state.usage.cost.toFixed(3)}`}
                </span>
              )}

              {activeProject && (
                <button
                  type="button"
                  onClick={() => setProjectSettings(activeProject)}
                  title={`${activeProject.config.name} settings`}
                  className="flex size-9 items-center justify-center rounded text-ink-500 hover:bg-ink-850 hover:text-ink-100"
                >
                  ⚙
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowAccess(true)}
                title="How to reach this server"
                className="flex size-11 shrink-0 items-center justify-center gap-1.5 rounded font-mono text-[10px] text-ink-500 hover:bg-ink-850 hover:text-ink-100 md:size-auto md:px-1.5 md:py-1"
              >
                <StatusDot status={status} />
                <span className="hidden sm:inline">seq {state.seq}</span>
              </button>
            </>
          ) : (
            <span className="flex-1 text-[13px] text-ink-500">
              {meta ? "Attaching…" : "No session selected"}
            </span>
          )}
        </header>

        {state ? (
          <>
            <Transcript state={state} onRetryProvision={()=>activeId&&clientRef.current?.command("retry_provision",{sessionId:activeId})} onCleanup={()=>activeId&&clientRef.current?.command("cleanup_session",{sessionId:activeId})} onForceDelete={()=>activeId&&forceDelete(activeId)} />

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
            />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div>
              <p className="font-mono text-2xl tracking-tight">hy</p>
              <p className="mt-1 text-[13px] text-ink-500">
                One server, several harnesses, any number of screens.
              </p>
            </div>
            <Button variant="primary" onClick={startNew}>
              New session
            </Button>
          </div>
        )}
      </main>

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
