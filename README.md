# Omniplex — harness multiplexer

[![CI](https://github.com/asiraky/omniplex/actions/workflows/ci.yml/badge.svg)](https://github.com/asiraky/omniplex/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A Go server that drives multiple coding harnesses (Claude Code, Codex) behind one
canonical event protocol, plus a standalone web UI that attaches to live or
closed session transcripts from another paired device.

This implements the architecture in `omniplex-spec.md`, milestones 1–5
and 9: the event log, the session actor and fanout, the sync protocol, the Claude
adapter, the web UI, and the Codex adapter.

The core workflow from [`workspace-lifecycle-spec.md`](workspace-lifecycle-spec.md)
is implemented: projects and defaults, project-owned provision/deprovision
scripts, the readiness barrier, live setup output, and retryable cleanup.

## Quick start

```bash
npm install
npm run dev          # prints the loopback, LAN, and tailnet URLs it bound
```

One command. Go rebuilds and restarts on a `.go` change; the UI hot-reloads on a
`.tsx` change without a page refresh. Same URL as production.

For a release build:

```bash
npm run build        # web bundle + binary
npm start            # prints every URL it is reachable on
```

Two builds, for two different audiences:

- **`npm run build`** (~18 MB) — the local build. Smaller and quicker because it
  skips compiling the Claude bridge, which means Claude needs Node 18+ or Bun on
  the host. This is what you build while working on Omniplex.
- **`npm run build:bundled`** (~79 MB) — the distribution build. The bridge
  carries its own JS runtime, so whoever runs it needs neither Node nor Bun.
  This is what you hand to someone else: installing Omniplex should never mean
  installing Node first.

Both drive your own Claude Code install; neither ships Claude Code.

Every build also installs `omni` as a symlink beside the `omniplex` binary, so
either `./omniplex` or `./omni` starts the same server. Documentation uses the
full product name.

### Scripts

| | |
|---|---|
| `npm run dev` | Go + Vite together, hot reload, one URL |
| `npm run build` | production binary |
| `npm run build:bundled` | binary with the Claude bridge compiled in |
| `npm start` | run the built binary |
| `npm test` | `go test -race` plus a TypeScript typecheck |
| `npm run clean` | remove the binary and the built bundle |

**npm is the only package manager here.** Bun appears in exactly one script,
`build:sidecar`, and only as a compiler: `bun build --compile` is the one clean
way to emit a single-file executable carrying its own JS runtime, which is what
the optional bundled build needs. Dependencies there are installed with npm like
everywhere else. Nothing else in the repo requires Bun.

Open the URL, click **New session**, choose Claude or Codex, and prompt. The
harness runs as a subprocess of the server and uses the auth you already have
locally (`claude` and `codex` login state); Omniplex never sees a token.

By default Omniplex binds loopback plus every private LAN and running overlay address
it can safely identify. Open one of the printed URLs on another device and enter
the one-time pairing code from the terminal. Use `-addr` only when you need to
pin one specific interface.

### Development

```bash
npm run dev
```

One command runs both halves: `air` rebuilds and restarts the Go server on a
`.go` change, and Vite serves the web app with HMR. Output is prefixed `go` and
`web` so it is obvious which one is talking. Ctrl-C stops both.

**The URL is the same as production — `http://127.0.0.1:8787`, or the LAN or
tailnet address the banner prints.** The Go server fronts everything and proxies
whatever it does not own through to Vite, including the HMR WebSocket.

That direction is deliberate. The usual arrangement is the reverse — Vite in
front, forwarding `/api` to Go — but then the browser's origin is Vite's, which
means a second URL to keep straight, CORS on every call, and, because Vite would
reach Go from loopback, **every request arriving already trusted**. Pairing could
not be exercised in development at all. Fronting from Go keeps one origin and
one URL, and auth behaves in development exactly as it does in production: a
request from another device is refused until that device is paired.

So developing against a real phone is just the normal flow — open the tailnet
address, pair once, and every edit hot-reloads. Vite itself listens only on
loopback and is never exposed to the network.

For release the bundle is embedded with `go:embed` and served from the same
origin as the API, which is what avoids mixed-content and CORS problems when
reaching the server from a phone.

### Asset caching

The build emits content-hashed asset filenames, and the server serves them
`immutable` — the name changes when the content does, so a cached copy can
never be wrong. The document is the one file whose URL survives a rebuild, so
it is always revalidated (`no-cache` plus an ETag) and therefore always names
the current hashes.

Do not "tidy" this into a single uniform policy. Sending no headers let a
browser cache the document on its own judgement; it went on naming a hash the
next build had deleted, the script 404'd, and the app was silently dead with no
WebSocket — which presented as three unrelated bugs on a phone.
`internal/server/webassets_test.go` fails the build if either half is
weakened.

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `-addr` | auto | Bind one specific address instead of discovered private/overlay addresses |
| `-port` | `8787` | Port used for automatically selected addresses |
| `-bind-public` | off | Also bind globally routable addresses; explicit because this exposes Omniplex to the internet |
| `-db` | `~/.omniplex/omniplex.db` | Event log |
| `-cwd` | current directory | Default working directory for new sessions |
| `-claude-path` | discovered | Claude Code executable to drive |
| `-codex` | `codex` | Codex CLI |
| `-dev` | off | Serve the UI from the Vite dev server instead of the embedded bundle |
| `-vite-port` | 5199 | Where the Vite dev server listens (with `-dev`) |

## Harnesses are optional

No harness is required. Each adapter reports its own readiness, and the core
never learns what any of them need:

```
harness:  Claude Code  unavailable — Anthropic's Claude Agent SDK is not installed.
harness:  Codex        ready
```

A Codex-only user is never asked for Node, never has anything unpacked, and
sees no errors — just a greyed-out card explaining what Claude would need,
with a **Check again** button once they have installed it. The reverse holds
too. Adding a harness means writing one adapter; adding a UI means writing
none.

Claude needs a JavaScript runtime (Node 18+ or Bun) to host Anthropic's SDK.
`npm run build:bundled` produces a build that carries its own, so the person
running it needs neither.

## How it works

```
browser ──ws──▶ transport ──▶ fanout ──▶ session actor ──▶ event log (sqlite)
                                              │                   │
                                              ▼                   ▼
                                          adapter            projection
                                        (subprocess)         (rendered state)
```

**The log is the session.** Every fact — each streamed token, tool call,
permission request and its resolution — is an append-only event with a
per-session sequence number. State is a fold over that log; snapshots are a
latency cache you can delete without changing behaviour.

**Nothing lives in a connection.** A permission or elicitation request is a durable event, not
a promise held in a socket handler, so the laptop can answer a prompt the phone
triggered. Disconnecting does not cancel a turn; only an explicit cancel does.
Restarting the server preserves the session and its harness context. An active
turn is recorded as interrupted (server death cannot preserve its process), then
the harness is respawned with `claude --resume` / codex `thread/resume` for the
next turn.

**One goroutine owns each session.** All mutation happens in its select loop.
Fanout is non-blocking: a presenter that stops draining is dropped and told to
resync rather than growing server memory or stalling the turn.

### Attaching

Order is load-bearing. The server subscribes to the live stream *first*, then
reads history, then sends `synchronized`, then drains what buffered — which
closes the window where an event lands between the read and the subscription.
A cursor more than 1000 events behind gets a snapshot instead of a replay.

Clients generate a `commandId` per command and retry the same id after a
reconnect; the server replays the stored result rather than executing twice, so
"did my prompt land?" always has an answer.

## Adapters

Both were verified against the real CLIs, not against documentation.

**Claude** goes through Anthropic's official **Claude Agent SDK**, which is the
supported way to build on Claude Code. The SDK is TypeScript/Python only, so it
is hosted in a small Node bridge (`internal/adapter/claudecode/sidecar/`) that
this adapter spawns and speaks to over stdio. The bridge relays SDK messages
and permission decisions and holds no canonical-event logic, so upgrading the
SDK is `npm install`, not a rewrite.

**Omniplex never ships Claude Code.** The SDK is pointed at the install you already
have (`pathToClaudeCodeExecutable`), discovered automatically or pinned with
`-claude-path`.

**Codex** (`codex-cli` 0.147.0) speaks JSON-RPC over stdio via `codex
app-server`: `initialize` → `thread/start` → `turn/start`, with `item/*`
streaming notifications and server→client approval requests. Its protocol is
self-describing: `codex app-server generate-json-schema --out DIR`.

Adding a harness means writing one adapter. Adding a UI means writing none.

## Tests

```bash
npm test
```

The suite covers the invariants that "obvious" implementations quietly violate,
under `-race`: gapless sequencing, log-authoritative rebuild, idempotent apply,
attach completeness with events landing mid-attach, permission fungibility with
two presenters racing, a deliberately stalled consumer being dropped and
resynced, disconnect not cancelling a turn, and command idempotency.

It also enforces the architecture rather than trusting it:

- **Boundary tests** (`internal/arch`) fail the build if a core package imports
  a concrete harness, or if an adapter reaches back into the log, the fanout,
  or a connection.
- **Lifecycle tests** SIGKILL a stand-in host and assert the Claude bridge and
  the harness process it spawned both die. Without that, killing the server
  orphans a several-hundred-megabyte process holding a live session.
- **Framing tests** assert that nothing but framed JSON reaches the bridge's
  stdout, including when a dependency logs at import time, and that payloads
  containing newlines cannot split a frame.

## What is not built

Deliberately out of scope for this prototype, and listed so the gaps are known:
cross-process leases (fencing tokens), the terminal `HostServices` (harnesses run
their own tools directly), `allow_always` rule storage (it currently behaves as
allow-once), the Unix-socket transport, mDNS discovery, automatic client endpoint
failover/roaming, reload-persistent client command state, the ACP adapter, and the
cross-language conformance suite.

Remote devices are protected by one-time pairing and individually revocable
device tokens; loopback remains trusted unless a detected reverse proxy makes it
remote in practice. Public binding still requires `-bind-public`: pairing is an
access boundary, not a reason to expose an agent service casually.

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md)
before proposing a change. Security vulnerabilities should be reported privately
as described in [SECURITY.md](SECURITY.md), not filed as public issues.

## License

Omniplex is available under the [MIT License](LICENSE).
