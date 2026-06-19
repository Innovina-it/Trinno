import "server-only";

import { createDoc } from "@/lib/pma/clients/drive";
import {
  escapeHtml,
  docShell,
  section,
  subheading,
  metaLine,
  bullets,
  paragraph,
  SANS,
  MONO,
  MUTED,
} from "@/lib/pma/doc-style";
import type { ProjectPlan } from "./types";

// PLAN IMPORT — PROJECT CONTEXT SEED.
//
// At import time, render a deterministic "Project overview" from the extracted
// plan and write it into the workspace's Context folder, so the very first
// analysis run is grounded in the project's objectives, deliverables, partners
// and milestones. No Gemini call — the overview is exactly the plan, never
// invented; a human can edit it or drop more context docs beside it afterwards.

export const PROJECT_OVERVIEW_DOC_NAME = "Project overview";

// Pure: render the plan as a Trinno-branded Google Doc body (lib/pma/doc-style
// builds the import-safe HTML; createDoc hands it to Drive for native conversion).
export function renderProjectOverviewHtml(plan: ProjectPlan): string {
  // Partners = distinct WP leads + task owners (mirrors build.ts's identity).
  const partnerSet = new Set<string>();
  for (const wp of plan.workPackages) {
    if (wp.lead) partnerSet.add(wp.lead);
    for (const t of wp.tasks) if (t.owner) partnerSet.add(t.owner);
  }
  const partners = [...partnerSet];

  const parts: string[] = [];
  if (partners.length) {
    parts.push(
      `<p style="font-family:${SANS};font-size:12.5px;color:${MUTED};margin:0 0 24px">` +
        `<b style="font-family:${MONO};font-size:10px;letter-spacing:.1em;color:${MUTED}">PARTNERS&nbsp;&nbsp;</b>` +
        `${escapeHtml(partners.join(" · "))}</p>`,
    );
  }

  parts.push(section("Work packages & objectives"));
  for (const wp of plan.workPackages) {
    parts.push(`<div style="margin:0 0 22px">`);
    parts.push(subheading(`${wp.code} · ${wp.title}`));
    const meta = [wp.option, wp.lead ? `Lead ${wp.lead}` : null, `${wp.start} → ${wp.end}`]
      .filter(Boolean)
      .join(" · ");
    parts.push(metaLine(meta));
    if (wp.description.trim()) parts.push(paragraph(escapeHtml(wp.description)));
    if (wp.deliverables.length) {
      parts.push(
        `<p style="font-family:${SANS};font-size:12.5px;color:${MUTED};margin:8px 0 4px"><b>Deliverables</b></p>`,
      );
      parts.push(
        bullets(
          wp.deliverables.map((d) => {
            const tail = d.description.trim() ? ` · ${escapeHtml(d.description)}` : "";
            return `${escapeHtml(d.title)} (M${d.month}, due ${escapeHtml(d.due)})${tail}`;
          }),
        ),
      );
    }
    parts.push(`</div>`);
  }

  if (plan.milestones.length) {
    parts.push(section("Milestones"));
    parts.push(
      bullets(
        plan.milestones.map((m) => {
          const tail = m.description.trim() ? ` · ${escapeHtml(m.description)}` : "";
          return `<b>${escapeHtml(m.name)}</b> · ${escapeHtml(m.date)}${tail}`;
        }),
      ),
    );
  }

  return docShell({
    eyebrow: "Trinno · Project context",
    title: `${plan.workspaceName} · Project overview`,
    subLines: [
      {
        text: "Background for analysis. Edit this, or add more context files to this folder.",
        variant: "serif",
      },
    ],
    body: parts.join("\n"),
    footer: "Auto-generated from the imported plan · Trinno",
  });
}

// Write the overview into the Context folder. Returns the new Doc id + link.
export async function seedProjectContext(
  contextFolderId: string,
  plan: ProjectPlan,
): Promise<{ id: string; webViewLink: string }> {
  return createDoc({
    name: PROJECT_OVERVIEW_DOC_NAME,
    parentId: contextFolderId,
    content: renderProjectOverviewHtml(plan),
  });
}
