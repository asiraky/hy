// Wire types for the sync protocol. These mirror the Go definitions in
// internal/proto and internal/server; the protocol is the contract between
// them, and no language owns it.

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "refusal"
  | "cancelled"
  | "error";

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "other";

export type PermissionOutcome =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always"
  | "cancelled";

export interface ToolContent {
  type: "text" | "diff";
  text?: string;
  path?: string;
  oldText?: string;
  newText?: string;
}

export interface Item {
  id: string;
  kind: "message" | "tool";
  turnId?: string;
  role?: "user" | "agent";
  contentKind?: "text" | "thought";
  text?: string;
  toolKind?: ToolKind;
  title?: string;
  status?: ToolStatus;
  input?: unknown;
  content?: ToolContent[];
}

/** One file the session changed, aggregated across the whole session. */
export interface ChangedFile {
  path: string;
  /** The name the file had at the base, for a rename. */
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied";
  additions: number;
  deletions: number;
  binary?: boolean;
  untracked?: boolean;
}

/** The PR-style file list for a session's checkout, measured by Git itself. */
export interface SessionChanges {
  root: string;
  branch?: string;
  baseRef?: string;
  base?: string;
  files: ChangedFile[];
  additions: number;
  deletions: number;
  truncated?: boolean;
  /** Why the list is empty, when the reason is not "nothing changed". */
  warning?: string;
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: string;
  patch: string;
  binary?: boolean;
  truncated?: boolean;
}

/**
 * What one turn changed on disk, measured between the snapshots bracketing it.
 * A turn that changed nothing has none: the server does not report an empty
 * list, because "0 files changed" is noise on every turn that was a question.
 */
export interface TurnDiff {
  turnId: string;
  files: ChangedFile[];
  additions: number;
  deletions: number;
  truncated?: boolean;
  /** Why the turn's changes could not be measured, when they could not be. */
  error?: string;
}

export interface TurnRecovery {
  resumeOf: string;
  attempt: number;
}

export interface Turn {
  id: string;
  prompt: string;
  stopReason?: StopReason;
  error?: string;
  done: boolean;
  // Present only on a turn the server started itself, to continue work a
  // restart interrupted.
  recovery?: TurnRecovery;
  // What the turn changed on disk. Absent until the turn has finished and been
  // measured, and on any turn that changed nothing.
  diff?: TurnDiff;
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOutcome;
}

export interface PendingPermission {
  requestId: string;
  toolCallId: string;
  toolName: string;
  title: string;
  input?: unknown;
  options: PermissionOption[];
}

export interface PendingElicitation {
  requestId: string;
  prompt: string;
  schema: {
    type?: string;
    properties?: Record<string, Record<string, any>>;
    required?: string[];
    "x-url"?: string;
  };
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface PlanEntry {
  content: string;
  status: string;
  priority?: string;
}

export interface SessionState {
  sessionId: string;
  seq: number;
  cwd: string;
  harness: string;
  model: string;
  mode: string;
  effort: string;
  title: string;
  phase: "creating" | "provisioning" | "provision_failed" | "idle" | "turn" | "cleaning" | "cleanup_failed" | "closed";
  closed: boolean;
  workspace: WorkspaceState;
  items: Item[];
  turns: Turn[];
  plan: PlanEntry[];
  usage: Usage;
  pendingPermissions: PendingPermission[];
  pendingElicitations: PendingElicitation[];
}

export interface WorkspaceState {
  phase: string;
  projectId?: string;
  projectRoot?: string;
  mode?: string;
  effort?: string;
  branch?: string;
  baseRef?: string;
  hook?: string;
  command?: string;
  output?: string;
  error?: string;
  exitCode?: number;
  startedAt?: number;
  durationMs?: number;
  resources?: Record<string, unknown>;
  deleteAfterCleanup?: boolean;
}

export interface ProjectConfig {
  version: number;
  name: string;
  defaults: { harness?: string; model?: string; effort?: string; mode?: string; workspace?: string; baseBranch?: string };
  workspace: { suggestedRoot?: string; provision?: string; deprovision?: string; provisionTimeoutSeconds?: number; deprovisionTimeoutSeconds?: number };
}

export interface Project { id: string; root: string; config: ProjectConfig; createdAt: number; updatedAt: number }

/** One checkout a session could run in: the project root, or any worktree Git knows about. */
export interface Workspace {
  path: string;
  branch?: string;
  /** Short commit, for a detached worktree that has no branch. */
  head?: string;
  isRoot?: boolean;
  /** A live session already holds this checkout, so it is shown but not selectable. */
  busy?: boolean;
  busySessionId?: string;
  busyTitle?: string;
  locked?: boolean;
}

/** A `gh issue list` row, passed through verbatim so the user's own format function decides what matters. */
export interface Issue {
  number: number;
  title: string;
  url?: string;
  labels?: { name: string }[];
  assignees?: unknown;
}

/**
 * Per-machine preferences, kept in ~/.hy/config.json rather than the repo:
 * branchFormat is the operator's own naming habit, not the project's.
 */
export interface UserConfig {
  version: number;
  /** A JavaScript arrow function, issue in and branch name out, evaluated here. */
  branchFormat?: string;
  suggestIssues?: boolean;
}

export interface SessionMeta {
  id: string;
  cwd: string;
  harness: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  headSeq: number;
  phase: string;
  projectId?: string;
  branch?: string;
  model?: string;
  mode?: string;
  workspaceMode?: string;
}

export interface ModelMeta {
  id: string;
  label: string;
}

/**
 * One permission preset a harness offers. The id is opaque here: only the
 * adapter that declared it knows what it maps onto (Claude's single enum,
 * Codex's approval-policy × sandbox pair, or whatever a future harness has).
 */
export interface PermissionModeMeta {
  id: string;
  label: string;
  description?: string;
  /** Render with a warning treatment and confirm before entering. */
  danger?: boolean;
  /** Selected when the user has expressed no preference. */
  default?: boolean;
}

export interface Remedy {
  text: string;
  url?: string;
  command?: string;
}

export interface Availability {
  state: "ready" | "unavailable";
  reason?: string;
  remedy?: Remedy[];
  facts?: Record<string, string>;
}

/**
 * Everything the UI knows about a harness comes from the server, which gets it
 * from the adapter. Nothing here is hardcoded per harness, so adding one needs
 * no client change.
 */
export interface HarnessMeta {
  id: string;
  name: string;
  accent: string;
  docsUrl?: string;
  models: ModelMeta[];
  permissionModes: PermissionModeMeta[];
  availability: Availability;
}

export type Reachability = "loopback" | "lan" | "overlay" | "public";

export interface Endpoint {
  id: string;
  label: string;
  url: string;
  reachability: Reachability;
  /** True for an address that survives a DHCP lease or a change of network. */
  stable?: boolean;
  /**
   * True when the transport protects the traffic: TLS, or WireGuard for an
   * overlay address. A plain LAN address is not, and anything crossing it —
   * the pairing code, then the device token — is readable by whoever controls
   * that network.
   */
  encrypted?: boolean;
}

export interface OverlayInfo {
  installed: boolean;
  running: boolean;
  dnsName?: string;
  https: boolean;
  httpsUrl?: string;
}

export interface Access {
  endpoints: Endpoint[];
  overlay: OverlayInfo;
}

export interface Event {
  sessionId: string;
  seq: number;
  timestamp: number;
  type: string;
  payload: any;
}

export interface ServerFrame {
  type:
    | "welcome"
    | "sessions"
    | "snapshot"
    | "event"
    | "synchronized"
    | "resync"
    | "ack"
    | "error"
    | "pong";
  serverId?: string;
  /** Content hash of the server's UI bundle; a mismatch means we are stale. */
  build?: string;
  sessions?: SessionMeta[];
  harnesses?: HarnessMeta[];
  projects?: Project[];
  cwd?: string;
  access?: Access;
  sessionId?: string;
  seq?: number;
  state?: SessionState;
  event?: Event;
  commandId?: string;
  result?: any;
  error?: string;
}
