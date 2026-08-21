import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

/**
 * One terminal tab: an xterm bound to a pty the server spawned in the
 * session's checkout. The shell's lifetime is this component's — closing the
 * tab (or the panel unmounting the surface) hangs up the socket and the server
 * reaps the shell. A reconnect is a fresh shell; the surface says so rather
 * than pretending continuity it does not have.
 */
export function TerminalSurface({ sessionId }: { sessionId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);
  // Bumping this remounts the effect: a fresh socket, a fresh shell.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setGone(false);

    const term = new Terminal({
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      cursorBlink: true,
      convertEol: false,
      theme: { background: "#00000000" },
      allowTransparency: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/term?session=${encodeURIComponent(sessionId)}`);
    ws.binaryType = "arraybuffer";

    let open = false;
    ws.onopen = () => {
      open = true;
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) term.write(new Uint8Array(e.data));
    };
    ws.onclose = () => setGone(true);
    ws.onerror = () => ws.close();

    const data = term.onData((d) => {
      if (open && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data: d }));
    });
    const resize = term.onResize(({ cols, rows }) => {
      if (open && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols, rows }));
    });

    // Refit when the panel is resized — the panel drag changes our box without
    // any window resize firing.
    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(host);

    return () => {
      ro.disconnect();
      data.dispose();
      resize.dispose();
      ws.close();
      term.dispose();
    };
  }, [sessionId, generation]);

  return (
    <div className="relative h-full min-h-0 bg-black/90 p-1.5">
      <div ref={hostRef} className="h-full min-h-0 [&_.xterm]:h-full" />
      {gone && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-center">
          <p className="text-[13px] text-white/80">The shell ended or the connection dropped.</p>
          <button
            type="button"
            onClick={() => setGeneration((g) => g + 1)}
            className="rounded-md border border-white/30 px-3 py-1 text-[12px] text-white/90 transition-colors hover:bg-white/10"
          >
            Start a new shell
          </button>
        </div>
      )}
    </div>
  );
}
