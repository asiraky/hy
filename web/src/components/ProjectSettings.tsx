import { useMemo, useState } from "react";
import type { HarnessMeta, Issue, Project, ProjectConfig, UserConfig } from "../protocol";
import { Button } from "./ui";
import { makeFormatter } from "./WorkspacePicker";

// A stand-in issue, so the preview shows a real answer rather than describing one.
const sampleIssue: Issue = { number: 482, title: "Token refresh 500s after 24h", url: "", labels: [{ name: "bug" }] };

/**
 * The branch-name function is the operator's own habit, not the project's, so
 * it saves to ~/.hy/config.json even though it is edited on this screen.
 */
function BranchFormatField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const preview = useMemo(() => {
    const { format, error } = makeFormatter(value);
    if (error) return { text: error, bad: true };
    const out = format(sampleIssue);
    return out ? { text: out, bad: false } : { text: "function returned nothing for the sample issue", bad: true };
  }, [value]);
  return <>
    <h3 className="mt-5 text-[12px] font-medium text-ink-300">Branch names from issues <span className="font-normal text-ink-500">· this machine only</span></h3>
    <p className="mt-1 text-[11px] text-ink-500">A JavaScript function, issue in and branch name out. It names the worktrees suggested from your open GitHub issues.</p>
    <textarea value={value} onChange={e=>onChange(e.target.value)} spellCheck={false} rows={4} className={`${field} scroll-thin font-mono text-[11px]`}/>
    <p className={`mt-1 font-mono text-[11px] ${preview.bad?"text-amber-400/80":"text-ink-500"}`}>#{sampleIssue.number} → {preview.text}</p>
  </>;
}

const field = "mt-1 w-full rounded-lg border border-ink-800 bg-ink-850 px-3 py-2 text-[13px]";
type Listing={path:string;parent:string;dirs:string[];files:string[]};
function HookField({label,root,value,onChange}:{label:string;root:string;value:string;onChange:(v:string)=>void}) { const [open,setOpen]=useState(false);const [listing,setListing]=useState<Listing|null>(null);const load=async(path:string)=>{const r=await fetch(`/api/fs?path=${encodeURIComponent(path)}&root=${encodeURIComponent(root)}&files=1`);if(r.ok)setListing(await r.json() as Listing)};const choose=(path:string)=>{onChange(path.slice(root.replace(/\/$/,"").length+1));setOpen(false)};return <><label className="mt-3 block text-[11px] text-ink-500">{label}</label><div className="flex gap-2"><input value={value} onChange={e=>onChange(e.target.value)} placeholder={`scripts/hy-${label.toLowerCase()}`} className={`${field} min-w-0 font-mono text-[12px]`}/><Button onClick={()=>{setOpen(!open);if(!open)void load(root)}}>{open?"Done":"Choose…"}</Button></div>{open&&listing&&<div className="scroll-thin mt-2 max-h-44 overflow-y-auto rounded-lg border border-ink-800 bg-ink-850">{listing.path!==root&&<button type="button" onClick={()=>void load(listing.parent)} className="block w-full px-3 py-1.5 text-left font-mono text-[12px] text-ink-500">../</button>}{listing.dirs.map(d=><button key={d} type="button" onClick={()=>void load(`${listing.path}/${d}`)} className="block w-full px-3 py-1.5 text-left font-mono text-[12px]">{d}/</button>)}{listing.files.map(f=><button key={f} type="button" onClick={()=>choose(`${listing.path}/${f}`)} className="block w-full px-3 py-1.5 text-left font-mono text-[12px] text-accent">{f}</button>)}</div>}</>}
export function ProjectSettings({ project, defaultRoot, harnesses, userConfig, onAdd, onSave, onSaveUserConfig, onClose }: { project: Project|null; defaultRoot:string; harnesses:HarnessMeta[]; userConfig:UserConfig|null; onAdd:(root:string)=>Promise<void>; onSave:(id:string,cfg:ProjectConfig)=>Promise<void>; onSaveUserConfig:(cfg:UserConfig)=>Promise<void>; onClose:()=>void }) {
  const [root,setRoot]=useState(project?.root??defaultRoot);
  const [cfg,setCfg]=useState<ProjectConfig>(project?.config??{version:1,name:"",defaults:{harness:"codex",workspace:"local"},workspace:{suggestedRoot:".worktrees",provisionTimeoutSeconds:1800,deprovisionTimeoutSeconds:600}});
  const [user,setUser]=useState<UserConfig>(userConfig??{version:1});
  const [busy,setBusy]=useState(false); const [error,setError]=useState<string|null>(null);
  const save=async()=>{setBusy(true);setError(null);try{if(project){await onSave(project.id,cfg);await onSaveUserConfig(user)}else await onAdd(root);onClose()}catch(e){setError(e instanceof Error?e.message:String(e));setBusy(false)}};
  const defaults=(patch:Partial<ProjectConfig["defaults"]>)=>setCfg({...cfg,defaults:{...cfg.defaults,...patch}}); const workspace=(patch:Partial<ProjectConfig["workspace"]>)=>setCfg({...cfg,workspace:{...cfg.workspace,...patch}});
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}><div className="scroll-thin max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-ink-800 bg-ink-900 p-5" onClick={e=>e.stopPropagation()}>
    <h2 className="text-[15px] font-medium">{project?`${cfg.name} settings`:"Add project"}</h2>
    {!project?<><label className="mt-4 block text-[11px] uppercase text-ink-500">Project directory</label><input value={root} onChange={e=>setRoot(e.target.value)} className={`${field} font-mono text-[12px]`}/></>:<>
      <label className="mt-4 block text-[11px] uppercase text-ink-500">Project name</label><input value={cfg.name} onChange={e=>setCfg({...cfg,name:e.target.value})} className={field}/><p className="mt-1 font-mono text-[10px] text-ink-500">{project.root}/.hy/project.json</p>
      <h3 className="mt-5 text-[12px] font-medium text-ink-300">Agent defaults</h3><div className="mt-2 grid grid-cols-2 gap-2"><select value={cfg.defaults.harness??""} onChange={e=>defaults({harness:e.target.value})} className={field}>{harnesses.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select><input value={cfg.defaults.model??""} onChange={e=>defaults({model:e.target.value})} placeholder="Default model" className={field}/><select value={cfg.defaults.effort??""} onChange={e=>defaults({effort:e.target.value})} className={field}><option value="">Default effort</option><option>low</option><option>medium</option><option>high</option><option>xhigh</option><option>max</option></select><input value={cfg.defaults.mode??""} onChange={e=>defaults({mode:e.target.value})} placeholder="Permission/runtime mode" className={field}/><select value={cfg.defaults.workspace??"local"} onChange={e=>defaults({workspace:e.target.value})} className={field}><option value="local">Use project directory</option><option value="managed">Managed worktree</option></select></div>
      <h3 className="mt-5 text-[12px] font-medium text-ink-300">Workspace</h3><label className="mt-2 block text-[11px] text-ink-500">Base branch</label><input value={cfg.defaults.baseBranch??""} onChange={e=>defaults({baseBranch:e.target.value})} placeholder="main" className={`${field} font-mono text-[12px]`}/><HookField label="Provision" root={project.root} value={cfg.workspace.provision??""} onChange={v=>workspace({provision:v})}/><HookField label="Deprovision" root={project.root} value={cfg.workspace.deprovision??""} onChange={v=>workspace({deprovision:v})}/>
      <BranchFormatField value={user.branchFormat??""} onChange={v=>setUser({...user,branchFormat:v})}/>
    </>}{error&&<p className="mt-3 rounded bg-red-500/10 p-2 text-[11px] text-red-300">{error}</p>}<div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy||(!project&&!root)} onClick={save}>{busy?"Saving…":project?"Save":"Add project"}</Button></div>
  </div></div>;
}
