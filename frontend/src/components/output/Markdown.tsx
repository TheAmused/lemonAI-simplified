import { Fragment, memo, useMemo, useState, useRef, useEffect, type ReactNode } from "react";

type KatexModule = typeof import("katex").default;

let katexInstance: KatexModule | null = null;
let katexPromise: Promise<KatexModule> | null = null;

function loadKatex(): Promise<KatexModule> {
  if (katexInstance) return Promise.resolve(katexInstance);
  if (!katexPromise) {
    katexPromise = Promise.all([
      import("katex"),
      import("katex/dist/katex.min.css"),
    ])
      .then(([mod]) => {
        katexInstance = mod.default;
        return mod.default;
      })
      .catch((err) => {
        katexPromise = null;
        throw err;
      });
  }
  return katexPromise;
}

function MathView({ math, display = false }: { math: string; display?: boolean }) {
  const [katex, setKatex] = useState<KatexModule | null>(() => katexInstance);

  useEffect(() => {
    if (katex) return;
    let cancelled = false;
    void loadKatex()
      .then((loaded) => {
        if (!cancelled) setKatex(() => loaded);
      })
      .catch(() => {
        // Keep monospace fallback if KaTeX fails to load
      });
    return () => {
      cancelled = true;
    };
  }, [katex]);

  const html = useMemo(() => {
    if (!katex) return null;
    try {
      return katex.renderToString(math.trim(), {
        displayMode: display,
        throwOnError: false,
      });
    } catch {
      return null;
    }
  }, [katex, math, display]);

  if (!html) {
    return display ? (
      <div className="my-2 overflow-x-auto rounded bg-muted/40 p-2 font-mono text-xs">{math}</div>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{math}</code>
    );
  }

  return display ? (
    <div
      className="math-display my-2 overflow-x-auto py-1 text-center"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <span
      className="math-inline inline-block px-0.5 align-middle"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const INLINE =
  /(\$\$(?:[^\$]|\$(?!\$))+?\$\$|\\\[[\s\S]+?\\\]|`[^`\n]+`|~~(?!\s)[^~\n]+?(?<!\s)~~|\*\*\*(?!\s)[^*\n]+?(?<!\s)\*\*\*|\*\*(?!\s)[^*\n]+?(?<!\s)\*\*|\$(?!\s)(?:[^\$\n]|\\\$)+?(?<!\s)\$|\\\([\s\S]+?\\\)|\*(?!\s)[^*\n]+?(?<!\s)\*|\[[^\]\n]+\]\([^)\s]+\))/g;

export function renderInline(text: string): ReactNode[] {
  if (!text) return [];
  if (!/[\\$`*~\[]/.test(text)) {
    return [text];
  }

  return text.split(INLINE).map((part, i) => {
    if (!part) return null;

    if (
      (part.startsWith("$$") && part.endsWith("$$") && part.length >= 4) ||
      (part.startsWith("\\[") && part.endsWith("\\]") && part.length >= 4)
    ) {
      const math = part.slice(2, -2);
      return <MathView key={i} math={math} display />;
    }

    if (
      (part.startsWith("\\(") && part.endsWith("\\)") && part.length >= 4) ||
      (part.startsWith("$") && part.endsWith("$") && part.length >= 2)
    ) {
      const math = part.startsWith("\\(") ? part.slice(2, -2) : part.slice(1, -1);
      return <MathView key={i} math={math} display={false} />;
    }

    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }

    if (part.startsWith("~~") && part.endsWith("~~") && part.length >= 4) {
      return (
        <del key={i} className="line-through text-muted-foreground">
          {part.slice(2, -2)}
        </del>
      );
    }

    if (part.startsWith("***") && part.endsWith("***") && part.length > 6) {
      return (
        <strong key={i}>
          <em>{part.slice(3, -3)}</em>
        </strong>
      );
    }

    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }

    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ink underline underline-offset-2"
        >
          {link[1]}
        </a>
      );
    }

    return <Fragment key={i}>{part}</Fragment>;
  });
}

export type TableAlignment = "left" | "center" | "right" | "default";

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[]; start?: number }
  | { kind: "p"; text: string }
  | { kind: "math"; math: string }
  | { kind: "code"; language?: string; code: string }
  | {
      kind: "table";
      headers: string[];
      alignments: TableAlignment[];
      rows: string[][];
    }
  | { kind: "blockquote"; text: string }
  | { kind: "hr" }
  | { kind: "thought"; text: string };

function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) {
    text = text.slice(1);
  }
  if (text.endsWith("|") && !text.endsWith("\\|")) {
    text = text.slice(0, -1);
  }
  return text.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function parseAlignment(cell: string): TableAlignment {
  const clean = cell.trim();
  const left = clean.startsWith(":");
  const right = clean.endsWith(":");
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return "default";
}

function isTableSeparator(line: string): boolean {
  if (!line.includes("-")) return false;
  const cells = splitTableRow(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[]; start?: number } | null = null;
  let inMathBlock: { delimiter: "$$" | "\\]"; lines: string[] } | null = null;
  let inCodeBlock: { language?: string; lines: string[] } | null = null;
  let inThoughtBlock: { tag: "think" | "thought"; lines: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: "p", text: paragraph.join("\n") });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  const hasPipes = source.includes("|");
  const hasQuotes = source.includes(">");
  const hasDividers = source.includes("---") || source.includes("***") || source.includes("___");
  const hasThoughts = source.includes("<think>") || source.includes("<thought>");
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (inCodeBlock) {
      if (trimmed.startsWith("```")) {
        blocks.push({ kind: "code", language: inCodeBlock.language, code: inCodeBlock.lines.join("\n") });
        inCodeBlock = null;
      } else {
        inCodeBlock.lines.push(line);
      }
      continue;
    }

    if (inMathBlock) {
      if (trimmed.endsWith(inMathBlock.delimiter)) {
        const content = trimmed.slice(0, -inMathBlock.delimiter.length).trim();
        if (content) inMathBlock.lines.push(content);
        blocks.push({ kind: "math", math: inMathBlock.lines.join("\n") });
        inMathBlock = null;
      } else {
        inMathBlock.lines.push(line);
      }
      continue;
    }

    if (inThoughtBlock) {
      const closeTag = `</${inThoughtBlock.tag}>`;
      if (line.includes(closeTag)) {
        const closeIdx = line.indexOf(closeTag);
        const before = line.slice(0, closeIdx);
        const after = line.slice(closeIdx + closeTag.length);
        if (before) inThoughtBlock.lines.push(before);
        blocks.push({ kind: "thought", text: inThoughtBlock.lines.join("\n").trim() });
        inThoughtBlock = null;
        if (after.trim()) {
          lines[i] = after;
          i--;
        }
      } else {
        inThoughtBlock.lines.push(line);
      }
      continue;
    }

    const codeFence = /^```([a-zA-Z0-9_-]*)$/.exec(trimmed);
    if (codeFence) {
      flushParagraph();
      flushList();
      inCodeBlock = { language: codeFence[1] || undefined, lines: [] };
      continue;
    }

    if (trimmed === "$$" || trimmed === "\\[") {
      flushParagraph();
      flushList();
      inMathBlock = { delimiter: trimmed === "$$" ? "$$" : "\\]", lines: [] };
      continue;
    }

    const singleMath = /^(\$\$|\\\[)([\s\S]+?)(\$\$|\\\])$/.exec(trimmed);
    if (
      singleMath &&
      ((singleMath[1] === "$$" && singleMath[3] === "$$") ||
        (singleMath[1] === "\\[" && singleMath[3] === "\\]"))
    ) {
      if (list && (line.startsWith("   ") || line.startsWith("\t"))) {
        list.items[list.items.length - 1] += "\n" + trimmed;
        continue;
      }
      flushParagraph();
      flushList();
      blocks.push({ kind: "math", math: singleMath[2].trim() });
      continue;
    }

    if (hasThoughts && (line.includes("<think>") || line.includes("<thought>"))) {
      const thinkIdx = line.indexOf("<think>");
      const thoughtIdx = line.indexOf("<thought>");
      const tag: "think" | "thought" =
        thinkIdx !== -1 && (thoughtIdx === -1 || thinkIdx < thoughtIdx) ? "think" : "thought";
      const openTag = `<${tag}>`;
      const closeTag = `</${tag}>`;
      const openIdx = line.indexOf(openTag);
      const before = line.slice(0, openIdx);
      const rest = line.slice(openIdx + openTag.length);

      if (before.trim()) {
        paragraph.push(before);
      }
      flushParagraph();
      flushList();

      if (rest.includes(closeTag)) {
        const closeIdx = rest.indexOf(closeTag);
        const thoughtText = rest.slice(0, closeIdx);
        const after = rest.slice(closeIdx + closeTag.length);
        blocks.push({ kind: "thought", text: thoughtText.trim() });
        if (after.trim()) {
          lines[i] = after;
          i--;
        }
        continue;
      } else {
        inThoughtBlock = {
          tag,
          lines: rest.trim() ? [rest] : [],
        };
        continue;
      }
    }

    if (hasPipes && trimmed.includes("|") && i + 1 < lines.length) {
      const nextTrimmed = lines[i + 1].trim();
      if (nextTrimmed.includes("|") && isTableSeparator(nextTrimmed)) {
        const headerCells = splitTableRow(trimmed);
        const sepCells = splitTableRow(nextTrimmed);
        if (headerCells.length > 0 && sepCells.length === headerCells.length) {
          flushParagraph();
          flushList();
          const alignments = sepCells.map(parseAlignment);
          const rows: string[][] = [];
          let j = i + 2;
          while (j < lines.length) {
            const rowLine = lines[j].trim();
            if (!rowLine || !rowLine.includes("|")) break;
            if (rowLine.startsWith("```") || rowLine === "$$" || rowLine === "\\[") break;
            if (rowLine.startsWith("#")) break;
            if (j + 1 < lines.length && isTableSeparator(lines[j + 1].trim())) break;

            const rawRowCells = splitTableRow(rowLine);
            const rowCells = headerCells.map((_, colIdx) => rawRowCells[colIdx] ?? "");
            rows.push(rowCells);
            j++;
          }
          blocks.push({
            kind: "table",
            headers: headerCells,
            alignments,
            rows,
          });
          i = j - 1;
          continue;
        }
      }
    }

    if (hasDividers && /^(---|___|\*\*\*)$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "hr" });
      continue;
    }

    if (hasQuotes && (trimmed.startsWith("> ") || trimmed === ">")) {
      flushParagraph();
      flushList();
      const quoteLines: string[] = [];
      let j = i;
      while (j < lines.length) {
        const qTrimmed = lines[j].trim();
        if (qTrimmed.startsWith("> ") || qTrimmed === ">") {
          quoteLines.push(qTrimmed.startsWith("> ") ? qTrimmed.slice(2) : "");
          j++;
        } else {
          break;
        }
      }
      blocks.push({ kind: "blockquote", text: quoteLines.join("\n") });
      i = j - 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);

    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
    } else if (bullet || numbered) {
      flushParagraph();
      const kind = bullet ? "ul" : "ol";
      const startNum = numbered ? parseInt(numbered[1], 10) : undefined;
      const text = bullet ? bullet[1] : numbered![2];

      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [text], start: startNum };
      } else {
        list.items.push(text);
      }
    } else if (!trimmed) {

      if (list) {
        let continues = false;
        for (let j = i + 1; j < lines.length; j++) {
          const nextTrim = lines[j].trim();
          if (!nextTrim) continue;
          const nextBullet = /^\s*[-*+]\s+(.*)$/.exec(lines[j]);
          const nextNumbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(lines[j]);
          if (
            (list.kind === "ul" && nextBullet) ||
            (list.kind === "ol" && nextNumbered) ||
            lines[j].startsWith("   ") ||
            lines[j].startsWith("\t")
          ) {
            continues = true;
          }
          break;
        }
        if (!continues) {
          flushList();
        }
      }
      flushParagraph();
    } else if (list && (line.startsWith("   ") || line.startsWith("\t"))) {

      list.items[list.items.length - 1] += "\n" + trimmed;
    } else {
      flushList();
      paragraph.push(line);
    }
  }

  if (inMathBlock) {
    blocks.push({ kind: "math", math: inMathBlock.lines.join("\n") });
  }
  if (inCodeBlock) {
    blocks.push({ kind: "code", language: inCodeBlock.language, code: inCodeBlock.lines.join("\n") });
  }
  if (inThoughtBlock) {
    blocks.push({ kind: "thought", text: inThoughtBlock.lines.join("\n").trim() });
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function Table({
  headers,
  alignments,
  rows,
}: {
  headers: string[];
  alignments: TableAlignment[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto my-2 rounded-md border border-border">
      <table className="w-full text-xs text-left">
        <thead className="bg-muted/50 border-b border-border">
          <tr>
            {headers.map((header, colIdx) => {
              const align = alignments[colIdx] ?? "default";
              const alignClass =
                align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
              return (
                <th key={colIdx} className={`px-3 py-2 font-semibold ${alignClass}`}>
                  {renderInline(header)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-muted/30 transition-colors">
              {row.map((cell, colIdx) => {
                const align = alignments[colIdx] ?? "default";
                const alignClass =
                  align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
                return (
                  <td key={colIdx} className={`px-3 py-2 ${alignClass}`}>
                    {renderInline(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CodeBlock({
  code,
  language,
  isStreaming,
}: {
  code: string;
  language?: string;
  isStreaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setCopied(false);
        timeoutRef.current = null;
      }, 2000);
    } catch {}
  };

  return (
    <div className="rounded-md border border-border bg-secondary/60 my-2 overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground font-mono">
        <div className="flex items-center gap-2">
          <span className="code-lang font-semibold uppercase tracking-wider text-[11px]">
            {language || "code"}
          </span>
          {isStreaming && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
              title="Streaming code..."
              data-testid="code-streaming-indicator"
            />
          )}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="hover:text-foreground text-[11px] transition-colors cursor-pointer flex items-center gap-1"
        >
          {copied ? (
            <>
              <svg
                aria-hidden="true"
                className="w-3.5 h-3.5 text-emerald-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>Copied!</span>
            </>
          ) : (
            <>
              <svg
                aria-hidden="true"
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const HEADING_CLASS = ["text-xl", "text-lg", "text-base", "text-sm"];

export const Markdown = memo(function Markdown({
  source,
  isStreaming,
}: {
  source: string;
  isStreaming?: boolean;
}) {
  const blocks = useMemo(() => parseBlocks(source), [source]);

  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <p key={i} className={`font-semibold ${HEADING_CLASS[block.level - 1]}`}>
                {renderInline(block.text)}
              </p>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc pl-5 space-y-1.5">
                {block.items.map((item, j) => (
                  <li key={j} className="whitespace-pre-wrap leading-relaxed">
                    {renderInline(item)}
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} start={block.start} className="list-decimal pl-5 space-y-1.5">
                {block.items.map((item, j) => (
                  <li key={j} className="whitespace-pre-wrap leading-relaxed">
                    {renderInline(item)}
                  </li>
                ))}
              </ol>
            );
          case "math":
            return <MathView key={i} math={block.math} display />;
          case "code":
            return <CodeBlock key={i} code={block.code} language={block.language} isStreaming={isStreaming} />;
          case "table":
            return (
              <Table
                key={i}
                headers={block.headers}
                alignments={block.alignments}
                rows={block.rows}
              />
            );
          case "blockquote":
            return (
              <blockquote
                key={i}
                className="border-l-2 border-primary/70 pl-3 my-2 italic text-muted-foreground text-sm whitespace-pre-wrap"
              >
                {renderInline(block.text)}
              </blockquote>
            );
          case "thought":
            return (
              <details
                key={i}
                className="my-2 rounded border border-border/70 bg-muted/30 p-2 text-xs text-muted-foreground"
              >
                <summary className="cursor-pointer font-medium select-none text-foreground/80">
                  Thinking Process
                </summary>
                <div className="mt-1.5 whitespace-pre-wrap">{renderInline(block.text)}</div>
              </details>
            );
          case "hr":
            return <hr key={i} className="my-3 border-t border-border" />;
          default:
            return (
              <p key={i} className="whitespace-pre-wrap leading-relaxed">
                {renderInline(block.text)}
              </p>
            );
        }
      })}
    </>
  );
});
