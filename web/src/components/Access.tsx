import { useState } from "react";
import type { Access as AccessInfo, Endpoint } from "../protocol";
import { Button } from "./ui";
import { cx } from "../cx";

const reachLabel: Record<string, string> = {
  loopback: "this machine only",
  lan: "same network only",
  overlay: "anywhere, via Tailscale",
  public: "the open internet",
};

/**
 * Switching to another address is a navigation, not a reconnection.
 *
 * A device token is bound to the origin it was paired on — cookies are scoped
 * per host — so arriving at a different address means pairing it once. The
 * panel says so rather than letting the user discover it as a bounce to the
 * pairing screen.
 */
function EndpointRow({ endpoint, current }: { endpoint: Endpoint; current: boolean }) {
  return (
    <div
      className={cx(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5",
        current ? "border-accent/40 bg-accent/[0.07]" : "border-ink-800",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-ink-100">{endpoint.label}</span>
          {endpoint.stable && (
            <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-ink-300 uppercase">
              stable
            </span>
          )}
          {endpoint.encrypted === false && (
            <span className="rounded bg-amber-500/12 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-amber-400 uppercase">
              unencrypted
            </span>
          )}
          {current && <span className="ml-auto font-mono text-[10px] text-accent">connected</span>}
        </div>
        <p className="mt-0.5 font-mono text-[11px] break-all text-ink-500">{endpoint.url}</p>
        <p className="mt-0.5 text-[11px] text-ink-500">
          {reachLabel[endpoint.reachability] ?? endpoint.reachability}
        </p>
        {endpoint.encrypted === false && (
          // We cannot issue a certificate a browser trusts for a LAN address,
          // so the honest thing is to say what crossing it costs rather than
          // train people to click through a warning.
          <p className="mt-1 text-[11px] text-amber-400/80">
            Traffic here is not encrypted. On a network you do not control, the pairing code and
            this device's token can be read off the wire. The Tailscale address avoids that.
          </p>
        )}
      </div>

      {!current && (
        <a
          href={endpoint.url}
          className="mt-0.5 shrink-0 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[12px] text-ink-100 ring-1 ring-white/5 ring-inset hover:bg-ink-700"
        >
          Open
        </a>
      )}
    </div>
  );
}

export function AccessPanel({
  access,
  onEnableHTTPS,
  onDisableHTTPS,
  onClose,
}: {
  access: AccessInfo;
  onEnableHTTPS: () => Promise<void>;
  onDisableHTTPS: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const { overlay } = access;
  const stable = access.endpoints.find((e) => e.stable);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-4"
      onClick={onClose}
    >
      <div
        className="fade-in max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-ink-800 bg-ink-900 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl md:rounded-2xl md:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-medium">Reaching this server</h2>
        <p className="mt-0.5 text-[12px] text-ink-500">
          Every address hy is currently listening on.
        </p>

        {stable && (
          <p className="mt-3 rounded-lg border border-ink-800 bg-ink-850 p-2.5 text-[12px] text-ink-300">
            Bookmark the <span className="text-ink-100">{stable.label}</span> address — it keeps
            working when you leave the house, and it does not change when your network does.
          </p>
        )}

        <div className="mt-3 space-y-2">
          {access.endpoints.map((e) => (
            <EndpointRow
              key={e.id}
              endpoint={e}
              current={sameOrigin(e.url, location.origin)}
            />
          ))}
        </div>

        <p className="mt-2 text-[11px] text-ink-500">
          Opening a different address asks you to pair once there: a paired device is remembered
          per address.
        </p>

        <div className="mt-5 border-t border-ink-800 pt-4">
          <h3 className="text-[13px] font-medium">Remote access</h3>

          {!overlay.installed && (
            <p className="mt-1.5 text-[12px] text-ink-500">
              Tailscale is not installed. With it, this server gets a fixed name you can open from
              anywhere — no ports opened, no address to remember.{" "}
              <a
                href="https://tailscale.com/download"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline"
              >
                Install it
              </a>
              .
            </p>
          )}

          {overlay.installed && !overlay.running && (
            <p className="mt-1.5 text-[12px] text-ink-500">
              Tailscale is installed but not signed in. Sign in and reopen this panel.
            </p>
          )}

          {overlay.running && (
            <>
              <p className="mt-1.5 font-mono text-[11px] break-all text-ink-300">
                {overlay.dnsName}
              </p>

              {overlay.https ? (
                <>
                  <p className="mt-2 text-[12px] text-ink-500">
                    Served over HTTPS with a real certificate, so this page can be installed to
                    your home screen.
                  </p>
                  <Button
                    className="mt-3"
                    disabled={busy}
                    onClick={() => run(onDisableHTTPS)}
                    title="Runs: tailscale serve --https=443 off"
                  >
                    {busy ? "Working…" : "Turn off HTTPS"}
                  </Button>
                </>
              ) : (
                <>
                  <p className="mt-2 text-[12px] text-ink-500">
                    Traffic over Tailscale is already encrypted end to end. Turning on HTTPS adds a
                    real certificate, which is what browsers require before allowing home-screen
                    install and notifications.
                  </p>
                  <p className="mt-1.5 text-[11px] text-ink-500">
                    This changes your machine's Tailscale configuration and persists across
                    restarts. Undo it here, or with{" "}
                    <code className="font-mono">tailscale serve --https=443 off</code>.
                  </p>
                  <Button
                    variant="primary"
                    className="mt-3"
                    disabled={busy}
                    onClick={() => run(onEnableHTTPS)}
                  >
                    {busy ? "Working…" : "Turn on HTTPS"}
                  </Button>
                </>
              )}
            </>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 font-mono text-[12px] text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Compares origins so the current endpoint is marked whichever form it took. */
function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
