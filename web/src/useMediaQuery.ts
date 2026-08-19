import { useEffect, useState } from "react";

// Tailwind's `md` breakpoint. Layout is CSS-driven wherever possible, but a
// few decisions genuinely need JS — whether the sidebar starts open, whether
// to advertise a keyboard shortcut — and those must agree with the CSS.
const DESKTOP = "(min-width: 768px)";

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP).matches);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
