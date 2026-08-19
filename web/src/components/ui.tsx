import type { ReactNode } from "react";

import { cx } from "../cx";

// Static, so it is built once rather than handed to every Button as a fresh
// object on each render.
const BUTTON_TONES = {
  default: "bg-ink-800 text-ink-100 hover:bg-ink-700 ring-1 ring-inset ring-white/5",
  primary: "bg-accent text-ink-950 hover:brightness-110 font-medium",
  danger: "bg-red-500/10 text-red-300 hover:bg-red-500/20 ring-1 ring-inset ring-red-500/25",
  ghost: "text-ink-300 hover:bg-ink-850 hover:text-ink-100",
} as const;

/**
 * The accent colour travels with the harness from the server. This component
 * has no per-harness knowledge, so a new adapter styles itself.
 */
export function HarnessBadge({
  harness,
  accent,
  className,
}: {
  harness: string;
  accent?: string;
  className?: string;
}) {
  const style = accent
    ? {
        color: accent,
        backgroundColor: `color-mix(in oklch, ${accent} 12%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${accent} 25%, transparent)`,
      }
    : undefined;

  return (
    <span
      style={style}
      className={cx(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide uppercase",
        !accent && "bg-ink-800 text-ink-300 ring-1 ring-ink-700 ring-inset",
        className,
      )}
    >
      {harness}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("size-3.5 animate-spin", className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  className,
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition md:min-h-0",
        "disabled:cursor-not-allowed disabled:opacity-40",
        BUTTON_TONES[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function StatusDot({ status }: { status: "connecting" | "online" | "offline" }) {
  const tone =
    status === "online" ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400" : "bg-red-400";
  return (
    <span className="relative flex size-2">
      {status !== "offline" && (
        <span className={cx("absolute inline-flex size-full animate-ping rounded-full opacity-60", tone)} />
      )}
      <span className={cx("relative inline-flex size-2 rounded-full", tone)} />
    </span>
  );
}

// hmr probe
