import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";

// Build a deliverable Google Doc that is the ACTUAL ARISE/AEGIS Word skeleton —
// the branded header, the metadata table, Parts I/II/III, the annexes — not an
// HTML approximation. We reuse the same template + the same zipfile surgery the
// manual seeders use (build-templates.py / *.mjs), but run it in-process per
// deliverable so the import flow needs neither python nor the Docs API.
//
// The base is scripts/seeds/templates/arise.docx (the shared skeleton that still
// carries the ARISE identity strings + the [DOCUMENT TITLE]/[Document subtitle]
// placeholders). We swap the identity for the imported project at runtime — the
// same three substitutions build-templates.py makes for a per-project template —
// then fill the two deliverable placeholders, and hand back the patched .docx
// bytes for Drive to convert to a native Doc.

// Strings present verbatim in the ARISE template's XML (the identity to swap).
const T_SUB = "Augmented Rehabilitation &amp; Intelligent System for Enhancement";
const T_PARTNERS = "DINOGMI, University of Genoa, Studio Buccarella";
// The .docx entries that carry the header / table / body text we patch.
const FILES = ["word/document.xml", "word/header1.xml", "word/footer1.xml"];

// arise.docx lives in the seeds tree; resolved from the project root (Next's
// outputFileTracingRoot). Read once and cached — the bytes never change.
const TEMPLATE_PATH = join(
  process.cwd(),
  "scripts",
  "seeds",
  "templates",
  "arise.docx",
);

let baseTemplate: Uint8Array | null = null;
async function loadBaseTemplate(): Promise<Uint8Array> {
  if (!baseTemplate) baseTemplate = new Uint8Array(await readFile(TEMPLATE_PATH));
  return baseTemplate;
}

// XML text escape (matches build-templates.py's esc + the seeders' saxutils).
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type DeliverableDocxInput = {
  // The imported project's name, e.g. "AEGIS" — fills the H1, the page header,
  // and the "Project" cell (replaces the template's "ARISE").
  projectTitle: string;
  // Partners line for the metadata table. The plan's distinct owners fit here;
  // blank leaves the cell empty.
  partners?: string;
  // The deliverable's own title + subtitle ([DOCUMENT TITLE]/[Document subtitle]).
  deliverableTitle: string;
  subtitle: string;
};

// Patch the template in memory and return the .docx bytes. String replacement is
// safe because every target is contiguous in the XML (no run-splitting) — the
// same property build-templates.py and the seeders rely on. `replaceAll` (not
// `replace`) so the project name swaps in the header AND the table AND the H1.
export async function buildDeliverableDocx(
  input: DeliverableDocxInput,
): Promise<Uint8Array> {
  const base = await loadBaseTemplate();
  const entries = unzipSync(base);

  const project = esc(input.projectTitle);
  const partners = esc(input.partners ?? "");
  const title = esc(input.deliverableTitle);
  const subtitle = esc(input.subtitle);

  for (const rel of FILES) {
    const raw = entries[rel];
    if (!raw) continue;
    let xml = strFromU8(raw);
    // Identity swap (the imported project replaces ARISE's). The Task-lead cell
    // and footer keep "Innovina" — Innovina is the capofila on these imports.
    xml = xml.replaceAll(T_SUB, ""); // no project subtitle in an imported plan
    xml = xml.replaceAll(T_PARTNERS, partners);
    xml = xml.replaceAll("ARISE", project);
    // Per-deliverable fill.
    xml = xml.replaceAll("[DOCUMENT TITLE]", title);
    xml = xml.replaceAll("[Document subtitle]", subtitle);
    entries[rel] = strToU8(xml);
  }

  return zipSync(entries);
}

// Project title for the doc header: the workspace name minus a trailing
// "— Project Plan" suffix the extractor tends to add ("AEGIS — Project Plan" →
// "AEGIS"). Falls back to the full name when there is nothing to strip.
export function projectTitleFromWorkspaceName(name: string): string {
  return name.replace(/\s*[—–-]\s*project plan\s*$/i, "").trim() || name.trim();
}
