// One icon (and accent) per file type, keyed by extension. lucide's file-*
// family is the pragmatic choice: no new dependency, consistent stroke with
// every other icon in the app. The colour is a hint, not a legend — enough for
// a `.ts` chip to read differently from a `.css` one at a glance.

import {
  BracesIcon,
  DatabaseIcon,
  FileArchiveIcon,
  FileCodeIcon,
  FileCogIcon,
  FileImageIcon,
  FileJsonIcon,
  FileLockIcon,
  FileSpreadsheetIcon,
  FileTerminalIcon,
  FileTextIcon,
  FileTypeIcon,
  FileIcon,
  GitBranchIcon,
  GlobeIcon,
  PaletteIcon,
} from "lucide-react";
import type { ComponentType } from "react";

export interface FileIcon {
  Icon: ComponentType<{ className?: string }>;
  /** A text-* colour class; empty means the surrounding text colour. */
  tone: string;
}

const PLAIN: FileIcon = { Icon: FileIcon, tone: "" };

const BY_EXTENSION: Record<string, FileIcon> = {
  // JavaScript / TypeScript
  ts: { Icon: FileCodeIcon, tone: "text-blue-500" },
  mts: { Icon: FileCodeIcon, tone: "text-blue-500" },
  cts: { Icon: FileCodeIcon, tone: "text-blue-500" },
  tsx: { Icon: FileCodeIcon, tone: "text-sky-500" },
  js: { Icon: FileCodeIcon, tone: "text-yellow-500" },
  mjs: { Icon: FileCodeIcon, tone: "text-yellow-500" },
  cjs: { Icon: FileCodeIcon, tone: "text-yellow-500" },
  jsx: { Icon: FileCodeIcon, tone: "text-sky-500" },

  // Systems and services
  go: { Icon: FileCodeIcon, tone: "text-cyan-500" },
  rs: { Icon: FileCodeIcon, tone: "text-orange-500" },
  py: { Icon: FileCodeIcon, tone: "text-emerald-500" },
  rb: { Icon: FileCodeIcon, tone: "text-red-500" },
  java: { Icon: FileCodeIcon, tone: "text-amber-600" },
  kt: { Icon: FileCodeIcon, tone: "text-purple-500" },
  swift: { Icon: FileCodeIcon, tone: "text-orange-500" },
  c: { Icon: FileCodeIcon, tone: "text-blue-400" },
  h: { Icon: FileCodeIcon, tone: "text-blue-400" },
  cpp: { Icon: FileCodeIcon, tone: "text-blue-400" },
  hpp: { Icon: FileCodeIcon, tone: "text-blue-400" },
  cs: { Icon: FileCodeIcon, tone: "text-violet-500" },
  php: { Icon: FileCodeIcon, tone: "text-indigo-400" },

  // Web
  html: { Icon: GlobeIcon, tone: "text-orange-500" },
  css: { Icon: PaletteIcon, tone: "text-sky-400" },
  scss: { Icon: PaletteIcon, tone: "text-pink-400" },
  svg: { Icon: FileImageIcon, tone: "text-amber-500" },

  // Data and config
  json: { Icon: FileJsonIcon, tone: "text-yellow-600" },
  jsonc: { Icon: FileJsonIcon, tone: "text-yellow-600" },
  yaml: { Icon: BracesIcon, tone: "text-rose-400" },
  yml: { Icon: BracesIcon, tone: "text-rose-400" },
  toml: { Icon: FileCogIcon, tone: "text-stone-400" },
  ini: { Icon: FileCogIcon, tone: "text-stone-400" },
  env: { Icon: FileLockIcon, tone: "text-lime-600" },
  sql: { Icon: DatabaseIcon, tone: "text-teal-500" },
  csv: { Icon: FileSpreadsheetIcon, tone: "text-green-600" },

  // Text
  md: { Icon: FileTextIcon, tone: "text-slate-400" },
  mdx: { Icon: FileTextIcon, tone: "text-slate-400" },
  txt: { Icon: FileTextIcon, tone: "" },
  rst: { Icon: FileTextIcon, tone: "text-slate-400" },

  // Shell
  sh: { Icon: FileTerminalIcon, tone: "text-green-500" },
  bash: { Icon: FileTerminalIcon, tone: "text-green-500" },
  zsh: { Icon: FileTerminalIcon, tone: "text-green-500" },
  fish: { Icon: FileTerminalIcon, tone: "text-green-500" },
  ps1: { Icon: FileTerminalIcon, tone: "text-blue-400" },

  // Assets
  png: { Icon: FileImageIcon, tone: "text-fuchsia-400" },
  jpg: { Icon: FileImageIcon, tone: "text-fuchsia-400" },
  jpeg: { Icon: FileImageIcon, tone: "text-fuchsia-400" },
  gif: { Icon: FileImageIcon, tone: "text-fuchsia-400" },
  webp: { Icon: FileImageIcon, tone: "text-fuchsia-400" },
  ico: { Icon: FileImageIcon, tone: "text-fuchsia-400" },
  zip: { Icon: FileArchiveIcon, tone: "text-stone-400" },
  gz: { Icon: FileArchiveIcon, tone: "text-stone-400" },
  tar: { Icon: FileArchiveIcon, tone: "text-stone-400" },
  woff: { Icon: FileTypeIcon, tone: "text-stone-400" },
  woff2: { Icon: FileTypeIcon, tone: "text-stone-400" },
  ttf: { Icon: FileTypeIcon, tone: "text-stone-400" },
};

// Files whose name is the type, extension or not.
const BY_NAME: Record<string, FileIcon> = {
  makefile: { Icon: FileCogIcon, tone: "text-stone-400" },
  dockerfile: { Icon: FileCogIcon, tone: "text-blue-400" },
  ".gitignore": { Icon: GitBranchIcon, tone: "text-orange-400" },
  ".gitattributes": { Icon: GitBranchIcon, tone: "text-orange-400" },
  "go.mod": { Icon: FileCogIcon, tone: "text-cyan-500" },
  "go.sum": { Icon: FileLockIcon, tone: "text-cyan-500" },
  "package.json": { Icon: FileJsonIcon, tone: "text-lime-600" },
  "package-lock.json": { Icon: FileLockIcon, tone: "text-lime-600" },
  ".env": { Icon: FileLockIcon, tone: "text-lime-600" },
  license: { Icon: FileTextIcon, tone: "text-slate-400" },
  readme: { Icon: FileTextIcon, tone: "text-slate-400" },
};

export function fileIconFor(path: string): FileIcon {
  const slash = path.lastIndexOf("/");
  const name = (slash === -1 ? path : path.slice(slash + 1)).toLowerCase();
  const named = BY_NAME[name] ?? BY_NAME[name.replace(/\.(md|txt)$/, "")];
  if (named) return named;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return PLAIN;
  return BY_EXTENSION[name.slice(dot + 1)] ?? PLAIN;
}
