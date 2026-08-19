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

export interface Turn {
  id: string;
  prompt: string;
  stopReason?: StopReason;
  error?: string;
  done: boolean;
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
  title: string;
  phase: "idle" | "turn" | "closed";
  closed: boolean;
  items: Item[];
  turns: Turn[];
  plan: PlanEntry[];
  usage: Usage;
  pendingPermissions: PendingPermission[];
  pendingElicitations: PendingElicitation[];
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
}

export interface ModelMeta {
  id: string;
  label: string;
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
