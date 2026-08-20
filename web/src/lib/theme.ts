import { createContext, useContext } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/**
 * Shared with the inline boot script in index.html, which applies the stored
 * choice before first paint. Change it in one place and the other is wrong, so
 * the two are commented as a pair.
 */
export const THEME_STORAGE_KEY = "hy.theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function prefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

export function watchSystemTheme(onChange: (resolved: ResolvedTheme) => void): () => void {
  const mq = window.matchMedia(DARK_QUERY);
  const handler = (e: MediaQueryListEvent) => onChange(e.matches ? "dark" : "light");
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

export function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? (prefersDark() ? "dark" : "light") : theme;
}

/**
 * The one place the class is written. The browser chrome is coloured from the
 * theme's own background rather than a second hardcoded literal, so the status
 * bar on a phone cannot drift out of step with the page behind it.
 */
export function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const background = getComputedStyle(root).getPropertyValue("--background").trim();
    if (background) meta.setAttribute("content", background);
  }
}

export interface ThemeContextValue {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
