import type { ReactNode } from "react";

// Minimal markdown renderer. Supports:
// - `# H1`, `## H2`, `### H3` (line-leading)
// - `**bold**`, `*italic*`, `` `code` ``
// - `[text](url)` links (URL must start with http(s):// or /)
// - Bullet lines starting with `- ` or `* `
// - Blank lines = paragraph break
// No HTML passthrough; React text rendering escapes angle brackets.

function renderInline(text: string): ReactNode[] {
  const tokenRe =
    /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\))/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = tokenRe.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined) {
      out.push(<strong key={key++}>{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      out.push(<em key={key++}>{m[3]}</em>);
    } else if (m[4] !== undefined) {
      out.push(
        <code
          key={key++}
          className="px-1 py-px rounded bg-[color:var(--surface-strong)] mono-meta-sm text-fg"
        >
          {m[4]}
        </code>,
      );
    } else if (m[5] !== undefined && m[6] !== undefined) {
      out.push(
        <a
          key={key++}
          href={m[6]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fg underline underline-offset-4 decoration-hairline-hi hover:decoration-fg"
        >
          {m[5]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderMarkdown(body: string): ReactNode[] {
  if (!body.trim()) return [];
  const lines = body.split("\n");
  const blocks: ReactNode[] = [];
  let key = 0;
  let para: string[] = [];
  let bullets: string[] = [];

  function flushPara() {
    if (para.length === 0) return;
    blocks.push(
      <p key={key++} className="text-sm leading-relaxed">
        {renderInline(para.join(" "))}
      </p>,
    );
    para = [];
  }
  function flushBullets() {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={key++} className="text-sm leading-relaxed list-disc pl-5 space-y-1">
        {bullets.map((b, i) => (
          <li key={i}>{renderInline(b)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  }
  function flushAll() {
    flushPara();
    flushBullets();
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line === "") {
      flushAll();
      continue;
    }
    if (/^###\s+/.test(line)) {
      flushAll();
      blocks.push(
        <h4
          key={key++}
          className="font-sans text-base font-bold tracking-tight text-fg mt-2"
        >
          {renderInline(line.replace(/^###\s+/, ""))}
        </h4>,
      );
      continue;
    }
    if (/^##\s+/.test(line)) {
      flushAll();
      blocks.push(
        <h3
          key={key++}
          className="font-sans text-lg font-bold tracking-tight text-fg mt-2"
        >
          {renderInline(line.replace(/^##\s+/, ""))}
        </h3>,
      );
      continue;
    }
    if (/^#\s+/.test(line)) {
      flushAll();
      blocks.push(
        <h2
          key={key++}
          className="font-sans text-xl font-bold tracking-tight text-fg mt-2"
        >
          {renderInline(line.replace(/^#\s+/, ""))}
        </h2>,
      );
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      bullets.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }
    flushBullets();
    para.push(line);
  }
  flushAll();
  return blocks;
}

export function MarkdownView({
  body,
  className,
  emptyText,
}: {
  body: string;
  className?: string;
  emptyText?: string;
}) {
  if (!body.trim()) {
    return emptyText ? (
      <div className={`text-sm text-fg-faint ${className ?? ""}`}>
        {emptyText}
      </div>
    ) : null;
  }
  return (
    <div className={`space-y-2 ${className ?? ""}`}>{renderMarkdown(body)}</div>
  );
}
