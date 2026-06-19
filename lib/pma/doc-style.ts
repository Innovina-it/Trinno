// Shared, pure HTML builders for the Trinno-branded Google Docs the PMA emits
// (the analysis report and the project-context overview). Google Drive converts
// these HTML strings into native Google Docs, so every construct here is chosen
// to survive that lossy import:
//   - the colored masthead is a single-cell full-width <table> (the only way a
//     background band survives);
//   - section headings are real <h2> (so the Doc gets an outline);
//   - meta + data tables use <td> with inline border/background/padding;
//   - lists use <ul>, the footer rule uses <hr>;
//   - color + font-family ride inline on each run; custom fonts fall back via
//     stacks; label text is UPPERCASED in the string (not via CSS text-transform,
//     which Docs may drop) so the machine-label look is guaranteed.
// Follows DESIGN.md (the "Studio Console"): ink on paper, mono uppercase
// micro-labels, hairline rules, strictly monochrome (no color behind text), and
// no em dashes anywhere.

export const INK = "#15102a";
export const BAND_BG = "#15102a";
export const BAND_FG = "#fafafa";
export const BAND_MUTED = "#a59fb6";
export const BAND_SERIF = "#c9c4d6";
export const MUTED = "rgba(21,16,42,.55)";
export const FAINT = "rgba(21,16,42,.4)";
export const HAIRLINE = "rgba(20,10,40,.12)";
export const ZEBRA = "rgba(20,10,40,.04)";

export const SANS = "Geist, Arial, sans-serif";
export const MONO = "'JetBrains Mono', 'Geist Mono', ui-monospace, monospace";
export const SERIF = "'Instrument Serif', Georgia, serif";

const BODY = `font-family:${SANS};font-size:13.5px;line-height:1.62;color:${INK}`;
const MONO_LABEL = `font-family:${MONO};letter-spacing:.14em;text-transform:uppercase`;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type SubLine = { text: string; variant?: "mono" | "serif" };

// The dark masthead band: a single-cell full-width table (the one import-safe
// way to get a colored band). eyebrow + title + optional sub-lines.
export function masthead(opts: { eyebrow: string; title: string; subLines?: SubLine[] }): string {
  const sub = (opts.subLines ?? [])
    .map((l) =>
      l.variant === "serif"
        ? `<div style="font-family:${SERIF};font-style:italic;font-size:15px;color:${BAND_SERIF};margin-top:8px">${escapeHtml(l.text)}</div>`
        : `<div style="font-family:${MONO};font-size:11px;letter-spacing:.1em;color:${BAND_MUTED};margin-top:10px">${escapeHtml(l.text).toUpperCase()}</div>`,
    )
    .join("");
  return (
    `<table style="border-collapse:collapse;width:100%;margin:0 0 26px"><tr>` +
    `<td style="background:${BAND_BG};padding:26px 30px">` +
    `<div style="font-family:${MONO};font-size:11px;letter-spacing:.16em;color:${BAND_MUTED}">${escapeHtml(opts.eyebrow).toUpperCase()}</div>` +
    `<div style="font-family:${SANS};font-size:30px;font-weight:800;letter-spacing:-.03em;line-height:1.05;color:${BAND_FG};margin-top:10px">${escapeHtml(opts.title)}</div>` +
    sub +
    `</td></tr></table>`
  );
}

// A section heading: a mono uppercase label as an <h2> (for the Doc outline),
// followed by a hairline rule.
export function section(label: string): string {
  return (
    `<h2 style="${MONO_LABEL};font-weight:500;font-size:11.5px;color:${MUTED};margin:26px 0 0">${escapeHtml(label).toUpperCase()}</h2>` +
    `<hr style="border:none;border-top:1px solid ${HAIRLINE};margin:8px 0 14px">`
  );
}

// A subheading (sans, semibold) for sub-blocks like a work package title.
export function subheading(text: string): string {
  return `<div style="font-family:${SANS};font-size:15px;font-weight:600;letter-spacing:-.01em;color:${INK};margin:0">${escapeHtml(text)}</div>`;
}

// A mono uppercase meta line (e.g. "RI · LEAD INNOVINA · 01/01 → 30/06").
export function metaLine(text: string): string {
  return `<div style="font-family:${MONO};font-size:10px;letter-spacing:.08em;color:${MUTED};margin:3px 0 8px">${escapeHtml(text).toUpperCase()}</div>`;
}

// A body paragraph. `html` is already escaped/processed (may carry <b>).
export function paragraph(html: string): string {
  return `<p style="${BODY};margin:0">${html || "(none)"}</p>`;
}

// A bullet list of already-processed HTML items; "(none)" when empty.
export function bullets(items: string[]): string {
  if (items.length === 0) return `<p style="${BODY};margin:0;color:${MUTED}">(none)</p>`;
  return `<ul style="${BODY};margin:0;padding-left:20px">${items.map((it) => `<li>${it}</li>`).join("")}</ul>`;
}

// A 2-column meta table (label | value). Labels mono uppercase muted; values escaped.
export function metaTable(rows: [string, string][]): string {
  const tr = rows
    .map(
      ([k, v]) =>
        `<tr>` +
        `<td style="border:1px solid ${HAIRLINE};padding:8px 12px;${MONO_LABEL};font-size:10px;letter-spacing:.1em;color:${MUTED};width:150px">${escapeHtml(k).toUpperCase()}</td>` +
        `<td style="border:1px solid ${HAIRLINE};padding:8px 12px;font-family:${MONO};font-size:11px;color:${INK}">${escapeHtml(v)}</td>` +
        `</tr>`,
    )
    .join("");
  return `<table style="border-collapse:collapse;width:100%;margin:0">${tr}</table>`;
}

// A bordered table: a mono uppercase header row + body rows. Body cells are RAW
// HTML (the caller escapes / styles them), so callers can drop mono spans in.
export function table(headers: string[], rows: string[][]): string {
  const head =
    `<tr>` +
    headers
      .map(
        (h) =>
          `<td style="border:1px solid ${HAIRLINE};padding:8px 12px;background:${ZEBRA};${MONO_LABEL};font-size:10px;letter-spacing:.1em;color:${MUTED}">${escapeHtml(h).toUpperCase()}</td>`,
      )
      .join("") +
    `</tr>`;
  const body = rows
    .map(
      (cells) =>
        `<tr>` +
        cells
          .map(
            (c) => `<td style="border:1px solid ${HAIRLINE};padding:8px 12px;font-family:${SANS};font-size:12.5px;color:${INK}">${c}</td>`,
          )
          .join("") +
        `</tr>`,
    )
    .join("");
  return `<table style="border-collapse:collapse;width:100%;margin:0">${head}${body}</table>`;
}

// A mono uppercase inline cell (for type / severity columns inside table()).
export function monoCell(text: string): string {
  return `<span style="font-family:${MONO};font-size:11px">${escapeHtml(text).toUpperCase()}</span>`;
}

// Wrap a whole document: masthead + body + a quiet mono footer rule.
export function docShell(opts: {
  eyebrow: string;
  title: string;
  subLines?: SubLine[];
  body: string;
  footer: string;
}): string {
  return (
    `<html><body style="font-family:${SANS};color:${INK}">` +
    masthead({ eyebrow: opts.eyebrow, title: opts.title, subLines: opts.subLines }) +
    opts.body +
    `<hr style="border:none;border-top:1px solid ${HAIRLINE};margin:32px 0 10px">` +
    `<div style="${MONO_LABEL};font-size:10px;letter-spacing:.1em;color:${FAINT}">${escapeHtml(opts.footer).toUpperCase()}</div>` +
    `</body></html>`
  );
}
