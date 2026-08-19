import { useRef, useState } from "react";
import type { HarnessMeta } from "../protocol";
import type { ConnectionStatus } from "../client";
import { Button, HarnessBadge } from "./ui";
import { cx } from "../cx";

interface DirListing {
  path: string;
  parent: string;
  dirs: string[];
}

export function NewSession({
  harnesses,
  defaultCwd,
  onCreate,
  onRecheck,
  onClose,
  status,
}: {
  harnesses: HarnessMeta[];
  defaultCwd: string;
  onCreate: (harness: string, cwd: string, model: string) => Promise<void>;
  onRecheck: () => void;
  onClose: () => void;
  status: ConnectionStatus;
}) {
  const [chosenHarness, setChosenHarness] = useState<string | null>(null);
  const [chosenModel, setChosenModel] = useState("");
  const [cwd, setCwd] = useState(defaultCwd);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived rather than synchronised. The harness list arrives with the
  // welcome frame, which on a phone can land after this dialog is open;
  // deriving means a late list is simply picked up on the next render, instead
  // of an effect having to notice and correct an empty choice.
  const selected =
    harnesses.find((h) => h.id === chosenHarness) ??
    harnesses.find((h) => h.availability.state === "ready") ??
    harnesses[0];
  const harness = selected?.id ?? "";
  const models = selected?.models ?? [];
  const availability = selected?.availability;
  const ready = availability?.state === "ready";

  // A model chosen for one harness need not exist on the next, so fall back to
  // the default instead of clearing it through an effect.
  const model = models.some((m) => m.id === chosenModel) ? chosenModel : "";

  // Why the start button is unavailable, in the user's terms. Silence here is
  // what made this state impossible to diagnose from the device.
  const blocker = busy
    ? null
    : status !== "online"
      ? `Not connected to the server (${status}).`
      : harnesses.length === 0
        ? "The server has not sent its harness list yet."
        : !selected
          ? "No harness selected."
          : !ready
            ? `${selected.name} is not ready: ${availability?.reason ?? "unknown reason"}`
            : null;

  // Browsing is a response to a click, not state to synchronise, so the fetch
  // lives in the handler. The counter discards a reply that a later navigation
  // has already superseded.
  const latestRequest = useRef(0);

  const loadDir = async (path: string) => {
    const request = latestRequest.current + 1;
    latestRequest.current = request;
    try {
      const response = await fetch(`/api/fs?path=${encodeURIComponent(path)}`);
      // fetch resolves on 4xx and 5xx, so an unchecked body read would treat
      // an error payload as a directory listing.
      if (!response.ok) {
        if (request === latestRequest.current) setListing(null);
        return;
      }
      const next = (await response.json()) as DirListing;
      if (request === latestRequest.current) setListing(next);
    } catch {
      if (request === latestRequest.current) setListing(null);
    }
  };

  const toggleBrowsing = () => {
    if (browsing) {
      setBrowsing(false);
      return;
    }
    setBrowsing(true);
    void loadDir(cwd);
  };

  const goTo = (path: string) => {
    setCwd(path);
    void loadDir(path);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCreate(harness, cwd, model);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="scroll-thin fade-in max-h-[85dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-ink-800 bg-ink-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-medium">New session</h2>
        <p className="mt-0.5 text-[12px] text-ink-500">
          The harness runs on the server, using its own local auth.
        </p>

        <fieldset className="mt-4 border-0 p-0">
          <legend className="block text-[11px] tracking-wide text-ink-500 uppercase">
            Harness
          </legend>
          {harnesses.length === 0 && (
            <p className="mt-1.5 text-[13px] text-ink-500">Waiting for the server…</p>
          )}

          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {harnesses.map((h) => {
              const isReady = h.availability.state === "ready";
              return (
              <button
                key={h.id}
                type="button"
                aria-pressed={harness === h.id}
                onClick={() => setChosenHarness(h.id)}
                title={isReady ? h.name : h.availability.reason}
                className={cx(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition",
                  harness === h.id
                    ? "border-accent/50 bg-accent/10"
                    : "border-ink-800 hover:border-ink-700",
                  !isReady && "opacity-50",
                )}
              >
                <HarnessBadge harness={h.id} accent={h.accent} />
                <span className="truncate">{h.name}</span>
                {!isReady && <span className="ml-auto text-[10px] text-ink-500">not set up</span>}
              </button>
              );
            })}
          </div>
        </fieldset>

        {/* An unavailable harness explains itself in its own terms. The UI
            renders what the adapter reported and interprets none of it. */}
        {availability && !ready && (
          <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3">
            <p className="text-[12px] text-ink-100">{availability.reason}</p>
            {(availability.remedy ?? []).map((r) => (
              <div key={`${r.text}|${r.command ?? r.url ?? ""}`} className="mt-2">
                <p className="text-[12px] text-ink-300">
                  {r.text}
                  {r.url && (
                    <>
                      {" — "}
                      <a href={r.url} target="_blank" rel="noreferrer" className="text-accent underline">
                        docs
                      </a>
                    </>
                  )}
                </p>
                {r.command && (
                  <code className="mt-1 block overflow-x-auto rounded bg-ink-950/70 px-2 py-1 font-mono text-[11px] text-ink-300">
                    {r.command}
                  </code>
                )}
              </div>
            ))}
            <Button className="mt-3" onClick={onRecheck}>
              Check again
            </Button>
          </div>
        )}

        {models.length > 1 && (
          <>
            <label
              htmlFor="new-session-model"
              className="mt-4 block text-[11px] tracking-wide text-ink-500 uppercase"
            >
              Model
            </label>
            <select
              id="new-session-model"
              value={model}
              onChange={(e) => setChosenModel(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-ink-800 bg-ink-850 px-3 py-2 text-[13px] focus:border-accent/50 focus:outline-none"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </>
        )}

        <label
          htmlFor="new-session-cwd"
          className="mt-4 block text-[11px] tracking-wide text-ink-500 uppercase"
        >
          Working directory
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="new-session-cwd"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-ink-800 bg-ink-850 px-3 py-2 font-mono text-[12px] focus:border-accent/50 focus:outline-none"
          />
          <Button onClick={toggleBrowsing}>{browsing ? "Done" : "Browse"}</Button>
        </div>

        {browsing && listing && (
          <div className="scroll-thin mt-2 max-h-44 overflow-y-auto rounded-lg border border-ink-800 bg-ink-850">
            <button
              type="button"
              aria-label="Go to the parent directory"
              onClick={() => goTo(listing.parent)}
              className="block w-full px-3 py-1.5 text-left font-mono text-[12px] text-ink-500 hover:bg-ink-800"
            >
              ../
            </button>
            {listing.dirs.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => goTo(`${listing.path.replace(/\/$/, "")}/${d}`)}
                className="block w-full truncate px-3 py-1.5 text-left font-mono text-[12px] hover:bg-ink-800"
              >
                {d}/
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 font-mono text-[12px] text-red-300">
            {error}
          </p>
        )}

        {blocker && (
          <p className="mt-4 rounded-lg bg-ink-850 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-500">
            {blocker}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !ready} onClick={create} title={blocker ?? undefined}>
            {busy ? "Starting…" : "Start"}
          </Button>
        </div>
      </div>
    </div>
  );
}
