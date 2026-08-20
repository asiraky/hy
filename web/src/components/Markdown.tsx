import type { Element, Text } from "hast";
import { CheckIcon, CopyIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { cn } from "~/lib/utils";

// Text arrives a character at a time, so at any moment the parser is being
// handed a document that is very likely mid-sentence. Most half-written
// constructs are harmless — an unfinished `**bold` is just literal text until
// its closing pair lands. A fence is the exception: an opening ``` with no
// close makes every line after it a paragraph, then reflows the lot into a
// code block the instant the close arrives. Closing it here means the block is
// a code block from its first line and simply grows.
function closeOpenFence(text: string): string {
  let open: string | null = null;
  for (const line of text.split("\n")) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (!m) continue;
    if (open === null) open = m[1][0];
    else if (m[1][0] === open) open = null;
  }
  return open === null ? text : `${text}\n${open.repeat(3)}`;
}

// The fenced text as the author wrote it, straight off the syntax tree — the
// rendered children would have lost the newlines that make it copyable.
function codeText(node: Element | undefined): string {
  const code = node?.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
  const raw = (code ?? node)?.children
    .filter((c): c is Text => c.type === "text")
    .map((c) => c.value)
    .join("");
  return (raw ?? "").replace(/\n$/, "");
}

function codeLang(node: Element | undefined): string {
  const code = node?.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
  const classes = code?.properties?.className;
  const list = Array.isArray(classes) ? classes.map(String) : [];
  return list.find((c) => c.startsWith("language-"))?.slice("language-".length) ?? "";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    try {
      // Only available over https or on localhost; hy is served over both, so
      // the failure has to be said out loud rather than silently doing nothing.
      if (!navigator.clipboard) throw new Error("Clipboard unavailable in this context");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      toast.error("Could not copy", { description: e instanceof Error ? e.message : String(e) });
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy code"}
      className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex size-6 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
    >
      {copied ? <CheckIcon className="text-success size-3" /> : <CopyIcon className="size-3" />}
    </button>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="bg-muted/60 my-2 overflow-hidden rounded-lg border">
      <div className="text-muted-foreground flex items-center gap-2 border-b px-2.5 py-1">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{lang || "text"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="scroll-thin overflow-x-auto overscroll-x-contain p-2.5 font-mono text-[12px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// Block spacing is set on the elements themselves rather than on the container
// so a message that is one paragraph — which most are — has no leading or
// trailing gap of its own to fight with the transcript's own rhythm.
const COMPONENTS: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mt-4 mb-2 text-[17px] font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-4 mb-2 text-[16px] font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-[15px] font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</h5>,
  h6: ({ children }) => (
    <h6 className="text-muted-foreground mt-3 mb-1.5 font-semibold first:mt-0">{children}</h6>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="[&>ul]:my-1 [&>ol]:my-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="text-muted-foreground my-2 border-l-2 pl-3 first:mt-0 last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3" />,
  a: ({ href, children }) => (
    <a
      href={href}
      // Model output is untrusted: a new tab must not be handed a window
      // reference back into this one.
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  // Only inline code reaches this: fenced blocks are taken by `pre` below and
  // rendered without descending into their children.
  code: ({ children }) => (
    <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
  ),
  pre: ({ node }) => <CodeBlock code={codeText(node)} lang={codeLang(node)} />,
  table: ({ children }) => (
    <div className="scroll-thin my-2 overflow-x-auto overscroll-x-contain rounded-lg border first:mt-0 last:mb-0">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="bg-muted/60 border-b px-2.5 py-1.5 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-b px-2.5 py-1.5 align-top last:border-b-0">{children}</td>,
  img: ({ src, alt }) => (
    <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} className="my-2 max-w-full rounded-lg" loading="lazy" />
  ),
};

const PLUGINS = [remarkGfm, remarkBreaks];

/**
 * Markdown as an agent writes it: GitHub flavour, single newlines kept as
 * newlines because model prose relies on them, and raw HTML dropped rather
 * than executed — `rehype-raw` is deliberately absent, so any HTML in the
 * output is text on the page and nothing more.
 *
 * Memoised on the text, so a message that has stopped changing is not
 * re-parsed every time a later one grows.
 */
export const Markdown = memo(function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
        {closeOpenFence(text)}
      </ReactMarkdown>
    </div>
  );
});
