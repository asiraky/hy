import { useState } from "react";
import type { HarnessMeta, Project } from "../protocol";
import type { ConnectionStatus } from "../client";
import { Button, HarnessBadge } from "./ui";

export interface NewSessionInput { projectId: string; harness: string; model: string; branch: string; workspace: string }

export function NewSession({ projects, harnesses, onCreate, onAddProject, onSettings, onRecheck, onClose, status }: {
  projects: Project[]; harnesses: HarnessMeta[]; onCreate: (input: NewSessionInput) => Promise<void>;
  onAddProject: () => void; onSettings: (project: Project) => void; onRecheck: () => void; onClose: () => void; status: ConnectionStatus;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [chosenHarness, setChosenHarness] = useState("");
  const [chosenModel, setChosenModel] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = projects.find(p => p.id === projectId) ?? projects[0];
  const harnessId = chosenHarness || project?.config.defaults.harness || harnesses.find(h => h.availability.state === "ready")?.id || harnesses[0]?.id || "";
  const selected = harnesses.find(h => h.id === harnessId);
  const model = selected?.models.some(m => m.id === chosenModel) ? chosenModel : project?.config.defaults.model ?? "";
  const workspace = project?.config.defaults.workspace ?? "local";
  const ready = status === "online" && !!project && selected?.availability.state === "ready";
  const create = async () => { if (!project) return; setBusy(true); setError(null); try { await onCreate({projectId:project.id,harness:harnessId,model,branch,workspace}); } catch(e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); } };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
    <div className="scroll-thin fade-in max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-ink-800 bg-ink-900 p-5 shadow-2xl" onClick={e=>e.stopPropagation()}>
      <h2 className="text-[15px] font-medium">New session</h2><p className="mt-0.5 text-[12px] text-ink-500">Pick a project. Hy prepares its workspace before starting the agent.</p>
      {projects.length === 0 ? <div className="mt-5 rounded-xl border border-dashed border-ink-700 p-5 text-center"><p className="text-[13px] text-ink-300">Add a project once, then create every session from here.</p><Button variant="primary" className="mt-3" onClick={onAddProject}>Add project</Button></div> : <>
        <label className="mt-4 block text-[11px] uppercase tracking-wide text-ink-500">Project</label><div className="mt-1.5 flex gap-2"><select value={project?.id} onChange={e=>{setProjectId(e.target.value);setChosenHarness("");setChosenModel("")}} className="min-w-0 flex-1 rounded-lg border border-ink-800 bg-ink-850 px-3 py-2 text-[13px]">{projects.map(p=><option key={p.id} value={p.id}>{p.config.name}</option>)}</select><Button onClick={()=>project&&onSettings(project)}>Settings</Button><Button onClick={onAddProject}>Add</Button></div>
        <label className="mt-4 block text-[11px] uppercase tracking-wide text-ink-500">Harness</label><div className="mt-1.5 grid grid-cols-2 gap-2">{harnesses.map(h=><button key={h.id} type="button" onClick={()=>setChosenHarness(h.id)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] ${harnessId===h.id?"border-accent/50 bg-accent/10":"border-ink-800"} ${h.availability.state!=="ready"?"opacity-50":""}`}><HarnessBadge harness={h.id} accent={h.accent}/>{h.name}</button>)}</div>
        {selected?.availability.state!=="ready" && <div className="mt-3 rounded bg-amber-500/10 p-3 text-[12px] text-ink-300">{selected?.availability.reason}<Button className="mt-2" onClick={onRecheck}>Check again</Button></div>}
        {(selected?.models.length ?? 0)>1 && <><label className="mt-4 block text-[11px] uppercase tracking-wide text-ink-500">Model</label><select value={model} onChange={e=>setChosenModel(e.target.value)} className="mt-1.5 w-full rounded-lg border border-ink-800 bg-ink-850 px-3 py-2 text-[13px]"><option value="">Default</option>{selected?.models.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></>}
        {workspace==="managed" && <><label className="mt-4 block text-[11px] uppercase tracking-wide text-ink-500">Branch</label><input value={branch} onChange={e=>setBranch(e.target.value)} placeholder="hy/session-name (optional)" className="mt-1.5 w-full rounded-lg border border-ink-800 bg-ink-850 px-3 py-2 font-mono text-[12px]"/></>}
      </>}
      {error&&<p className="mt-3 rounded bg-red-500/10 p-2 font-mono text-[11px] text-red-300">{error}</p>}<div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button>{projects.length>0&&<Button variant="primary" disabled={!ready||busy} onClick={create}>{busy?"Opening…":"Start"}</Button>}</div>
    </div>
  </div>;
}
