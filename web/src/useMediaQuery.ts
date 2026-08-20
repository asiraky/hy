import { useEffect, useState } from "react";

// Tailwind's `md` breakpoint. Layout is CSS-driven wherever possible, but a
// few decisions genuinely need JS — whether the sidebar starts open, whether
// to advertise a keyboard shortcut — and those must agree with the CSS.
const DESKTOP = "(min-width: 768px)";
// A pointer that cannot hover. Not the same question as screen size: a tablet
// is wide and touch-only, a small window on a laptop is narrow and has a mouse.
const COARSE = "(pointer: coarse)";

function useMatches(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function useIsDesktop(): boolean {
  return useMatches(DESKTOP);
}

export function useIsCoarsePointer(): boolean {
  return useMatches(COARSE);
}
