import type { ReactNode } from "react";

// Minimal markdown parser. Supports:
// - `# H1`, `## H2`, `### H3` (line-leading)
// - `**bold**`, `*italic*`
// - `[text](url)` links (URL must start with http(s):// or /).
// - Blank lines as paragraph breaks.
// Anything else is rendered as plain text. No HTML passthrough; angle brackets
// are escaped by React's text rendering, so script tags etc. are inert.

function renderInline(text: string): ReactNode[] {
  // Tokenize using a single regex covering all inline forms.
  const tokenRe = /(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\))/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = tokenRe.exec(text))) {
    if (m.index > last) {
      out.push(text.slice(last, m.index));
    }
    if (m[2] !== undefined) {
      out.push(<strong key={key++}>{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      out.push(<em key={key++}>{m[3]}</em>);
    } else if (m[4] !== undefined && m[5] !== undefined) {
      out.push(
        <a
          key={key++}
          href={m[5]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-[color:var(--accent-cyan)]"
        >
          {m[4]}
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
  function flushPara() {
    if (para.length === 0) return;
    blocks.push(
      <p key={key++} className="text-sm leading-relaxed">
        {renderInline(para.join(" "))}
      </p>,
    );
    para = [];
  }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line === "") {
      flushPara();
      continue;
    }
    if (/^###\s+/.test(line)) {
      flushPara();
      blocks.push(
        <h4 key={key++} className="serif-display text-lg mt-2">
          {renderInline(line.replace(/^###\s+/, ""))}
        </h4>,
      );
      continue;
    }
    if (/^##\s+/.test(line)) {
      flushPara();
      blocks.push(
        <h3 key={key++} className="serif-display text-xl mt-2">
          {renderInline(line.replace(/^##\s+/, ""))}
        </h3>,
      );
      continue;
    }
    if (/^#\s+/.test(line)) {
      flushPara();
      blocks.push(
        <h2 key={key++} className="serif-display text-2xl mt-2">
          {renderInline(line.replace(/^#\s+/, ""))}
        </h2>,
      );
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}

export function GadgetMarkdownNote({ body }: { body: string }) {
  if (!body.trim()) {
    return (
      <div className="text-fg-muted text-sm italic">Empty note.</div>
    );
  }
  return (
    <div
      className="space-y-2 overflow-y-auto max-h-full"
      data-testid="gadget-markdown"
    >
      {renderMarkdown(body)}
    </div>
  );
}
