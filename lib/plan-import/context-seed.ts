import "server-only";

import { createDoc } from "@/lib/pma/clients/drive";
import type { ProjectPlan } from "./types";

// PLAN IMPORT — PROJECT CONTEXT SEED.
//
// At import time, render a deterministic "Project overview" from the extracted
// plan and write it into the workspace's Context folder, so the very first
// analysis run is grounded in the project's objectives, deliverables, partners
// and milestones. No Gemini call — the overview is exactly the plan, never
// invented; a human can edit it or drop more context docs beside it afterwards.

export const PROJECT_OVERVIEW_DOC_NAME = "Project overview";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Pure: render the plan as an HTML body (createDoc converts it to a native Doc).
export function renderProjectOverviewHtml(plan: ProjectPlan): string {
  // Partners = distinct WP leads + task owners (mirrors build.ts's identity).
  const partnerSet = new Set<string>();
  for (const wp of plan.workPackages) {
    if (wp.lead) partnerSet.add(wp.lead);
    for (const t of wp.tasks) if (t.owner) partnerSet.add(t.owner);
  }
  const partners = [...partnerSet];

  const parts: string[] = [];
  parts.push(`<h1>${esc(plan.workspaceName)} — Project overview</h1>`);
  parts.push(
    "<p><i>Auto-generated from the imported plan as background for analysis. " +
      "Edit this document or add more context files (glossary, grant terms) to " +
      "this folder.</i></p>",
  );
  if (partners.length) {
    parts.push(`<p><b>Partners:</b> ${esc(partners.join(", "))}</p>`);
  }

  parts.push("<h2>Work packages &amp; objectives</h2>");
  for (const wp of plan.workPackages) {
    const meta = [wp.option, wp.lead ? `Lead ${wp.lead}` : null, `${wp.start} → ${wp.end}`]
      .filter(Boolean)
      .join(" · ");
    parts.push(`<h3>${esc(wp.code)} — ${esc(wp.title)}</h3>`);
    parts.push(`<p><i>${esc(meta)}</i></p>`);
    if (wp.description.trim()) parts.push(`<p>${esc(wp.description)}</p>`);
    if (wp.deliverables.length) {
      parts.push("<p><b>Deliverables:</b></p><ul>");
      for (const d of wp.deliverables) {
        const tail = d.description.trim() ? ` — ${esc(d.description)}` : "";
        parts.push(`<li>${esc(d.title)} (M${d.month}, due ${esc(d.due)})${tail}</li>`);
      }
      parts.push("</ul>");
    }
  }

  if (plan.milestones.length) {
    parts.push("<h2>Milestones</h2><ul>");
    for (const m of plan.milestones) {
      const tail = m.description.trim() ? ` — ${esc(m.description)}` : "";
      parts.push(`<li><b>${esc(m.name)}</b> — ${esc(m.date)}${tail}</li>`);
    }
    parts.push("</ul>");
  }

  return `<html><body>${parts.join("\n")}</body></html>`;
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
