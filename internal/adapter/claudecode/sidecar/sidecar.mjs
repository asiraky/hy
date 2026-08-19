// The Claude harness bridge.
//
// This is the only place in the project that talks to Anthropic's Agent SDK.
// It is deliberately dumb: it relays SDK messages to the host and relays the
// host's permission decisions back. It holds no canonical-event knowledge, so
// upgrading the SDK is `npm update` rather than a rewrite.
//
// Wire format: JSON-RPC 2.0, one object per line, over stdin/stdout.
//
//   host -> here (notifications):  prompt, interrupt, setModel
//   here -> host (notifications):  message, fatal
//   here -> host (request):        permission  -> {behavior, updatedInput?, message?}

// Imported first, and deliberately so: it installs stdout discipline before
// any other module is evaluated. See guard.mjs.
import { writeFrame } from "./guard.mjs";

import { query } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "node:readline";

const send = writeFrame;
const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
const respond = (id, result) => send({ jsonrpc: "2.0", id, result });
const respondError = (id, message) => send({ jsonrpc: "2.0", id, error: { code: -32000, message } });

// ---------------------------------------------------------------------------
// lifecycle
//
// The host owns this process. When the host's end of the pipe closes — which
// includes the host being SIGKILLed, where no handler of ours would run — our
// stdin reaches EOF and we exit, taking the harness process with us. Without
// this, killing the host orphans both this process and the several-hundred-MB
// harness it spawned.
// ---------------------------------------------------------------------------
let shuttingDown = false;
const die = (code) => {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exit(code);
};
process.stdin.on("end", () => die(0));
process.stdin.on("close", () => die(0));
process.on("SIGTERM", () => die(0));
process.on("SIGINT", () => die(0));
process.on("uncaughtException", (err) => {
  notify("fatal", { message: `uncaught: ${err?.stack ?? String(err)}` });
  die(1);
});
process.on("unhandledRejection", (err) => {
  notify("fatal", { message: `unhandled rejection: ${err?.stack ?? String(err)}` });
  die(1);
});

// ---------------------------------------------------------------------------
// config, supplied by the host on argv as a single JSON blob
// ---------------------------------------------------------------------------
const config = JSON.parse(process.argv[2] ?? "{}");

// ---------------------------------------------------------------------------
// prompts: the host sends them one at a time; the SDK consumes an async
// iterable, so this is a queue with a waiter.
// ---------------------------------------------------------------------------
const queued = [];
const waiters = [];
const pushPrompt = (text) => (waiters.length ? waiters.shift()(text) : queued.push(text));
const nextPrompt = () =>
  new Promise((resolve) => (queued.length ? resolve(queued.shift()) : waiters.push(resolve)));

async function* prompts() {
  while (!shuttingDown) {
    const text = await nextPrompt();
    yield {
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
    };
  }
}

// ---------------------------------------------------------------------------
// permissions: each canUseTool call becomes an outbound request; the host's
// response resolves it. The SDK's AbortSignal fires if the turn is cancelled,
// so a request the host never answers cannot hang the process forever.
// ---------------------------------------------------------------------------
const pending = new Map();
let requestSeq = 0;

const canUseTool = (toolName, input, { signal, suggestions }) =>
  new Promise((resolve) => {
    const id = ++requestSeq;
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      pending.delete(id);
      resolve(value);
    };

    pending.set(id, settle);
    signal?.addEventListener?.("abort", () => settle({ behavior: "deny", message: "Cancelled" }), {
      once: true,
    });

    send({
      jsonrpc: "2.0",
      id,
      method: "permission",
      params: { toolName, input, suggestions: suggestions ?? [] },
    });
  });

// ---------------------------------------------------------------------------
// the session
// ---------------------------------------------------------------------------
const session = query({
  prompt: prompts(),
  options: {
    cwd: config.cwd,
    includePartialMessages: true,
    canUseTool,
    ...(config.model ? { model: config.model } : {}),
    ...(config.permissionMode ? { permissionMode: config.permissionMode } : {}),
    // Mutually exclusive by SDK contract: sessionId names a new conversation,
    // resume continues an existing one.
    ...(config.resume ? { resume: config.resume } : {}),
    ...(config.sessionId && !config.resume ? { sessionId: config.sessionId } : {}),
    // Use the Claude Code the host resolved. We never ship one.
    ...(config.claudePath ? { pathToClaudeCodeExecutable: config.claudePath } : {}),
  },
});

// ---------------------------------------------------------------------------
// host -> here
// ---------------------------------------------------------------------------
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;

  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    notify("fatal", { message: "host sent an unparseable frame" });
    return;
  }

  // A response to one of our permission requests.
  if (frame.id !== undefined && frame.method === undefined) {
    const settle = pending.get(frame.id);
    if (!settle) return; // already aborted or answered; not an error
    if (frame.error) {
      settle({ behavior: "deny", message: frame.error.message ?? "Denied" });
      return;
    }
    settle(frame.result);
    return;
  }

  switch (frame.method) {
    case "prompt":
      pushPrompt(frame.params.text);
      break;
    case "interrupt":
      session.interrupt().catch((e) => notify("fatal", { message: `interrupt failed: ${e?.message ?? e}` }));
      break;
    case "setModel":
      session.setModel(frame.params.model || undefined).catch(() => {});
      break;
    default:
      if (frame.id !== undefined) respondError(frame.id, `unknown method: ${frame.method}`);
  }
});

// ---------------------------------------------------------------------------
// here -> host: relay every SDK message verbatim. Mapping to canonical events
// happens in Go, so this file stays stable across protocol changes.
// ---------------------------------------------------------------------------
try {
  for await (const message of session) {
    notify("message", { message });
  }
  notify("fatal", { message: "session ended" });
  die(0);
} catch (err) {
  notify("fatal", { message: err?.stack ?? String(err) });
  die(1);
}
