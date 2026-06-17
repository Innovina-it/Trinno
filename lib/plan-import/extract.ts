import "server-only";

import { generateStructured } from "@/lib/pma/clients/gemini";
import { ProjectPlanSchema, type ProjectPlan } from "./types";
import { PROJECT_PLAN_GENAI_SCHEMA } from "./genai-schema";

const EXTRACTION_PROMPT = `You are reading a project-plan / grant document (a "bando",
"Relazione tecnica" or "Piano di Lavoro"), often in Italian. It may be a PDF, an image,
or text. Extract its structure as JSON matching the provided schema.

Rules:
- Output English for all titles and descriptions, even if the source is Italian.
- workspaceName: the project title, suffixed " — Project Plan". parentBoardTitle: "<project> · Project Plan".
- One workPackage per WP (use the WP summary table for codes, titles, the RI/SS option, and the
  real start/end dates as YYYY-MM-DD).
- tasks: the activities (Tx.y) listed under each WP.
- deliverables: the named results (Dx.y). taskIndex = the 0-based index of the task in THIS work
  package that the deliverable most relates to. due = its due date (YYYY-MM-DD); month = its M-number.
- lead: the WP's responsible partner / leader, if stated.
- milestones: if the document has a milestone table, use it. Otherwise DERIVE 3-6 milestones from the
  WP end-dates and the named mid-term / closure deliverables (name like "M6 — Requirements Baseline").
- Keep descriptions concise (2-4 sentences). Do not invent work packages, tasks or deliverables that
  are not in the document.`;

export async function extractPlanFromFile(
  bytes: Buffer,
  mimeType: string,
): Promise<ProjectPlan> {
  const raw = await generateStructured<unknown>({
    model: "gemini-3.5-flash",
    prompt: EXTRACTION_PROMPT,
    responseSchema: PROJECT_PLAN_GENAI_SCHEMA,
    files: [{ mimeType, data: bytes.toString("base64") }],
    temperature: 0,
  });
  // The review UI lets the user fix anything; here we only guarantee a
  // structurally valid plan for the builder. Zod throws on a malformed shape.
  const plan = ProjectPlanSchema.parse(raw);
  // Pre-fill each task's owner from its work package's lead (the extracted
  // responsible partner), so the review shows it filled per task. The user can
  // edit or clear any of them.
  return {
    ...plan,
    workPackages: plan.workPackages.map((wp) => ({
      ...wp,
      tasks: wp.tasks.map((t) => ({
        ...t,
        owner: (t.owner?.trim() || wp.lead?.trim()) ?? "",
      })),
    })),
  };
}
