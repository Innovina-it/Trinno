# Import a Project Plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone in-app wizard that turns a project-plan PDF into a new trinno workspace — Gemini extracts the structure, the user reviews/edits it, then a RLS-safe server action builds the workspace (boards, sub-boards, cards, deliverables, milestones) with a native Google Doc per deliverable.

**Architecture:** Reuse the existing PMA infrastructure. `lib/pma/clients/gemini.ts` (extended to carry a PDF part) extracts a structured `ProjectPlan`; a new `lib/plan-import/build.ts` chains the existing `*Impl` server-action functions under the user's JWT (no service-role key); `lib/pma/clients/drive.ts` `createDoc` makes native Docs from HTML. A route handler receives the PDF (server actions can't take `File`); a server action does the build.

**Tech Stack:** Next.js App Router, TypeScript, `@google/genai` (`gemini-2.5-flash`), `googleapis` (Drive), Drizzle + Supabase RLS, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-16-plan-import-wizard-design.md`

**Conventions used by this codebase (read once):**
- Run a single test file: `npx vitest run <path>`. Typecheck: `npx tsc --noEmit`. Lint: `npm run lint`.
- Integration tests hit the **local** Supabase (`tests/integration/seed-demo.test.ts` is the template — admin-create a user, sign in for a JWT, call the impl, assert via `dbAsUser` + Drizzle).
- `*Impl(token, input)` functions decode the user id from the JWT and run inside `dbAsUser(token, ...)` so every write is RLS-checked. **`createCardImpl` does NOT accept `type`/`description`** — create the card, then `updateCardImpl({ id, type, description })` (see `actions/seed.ts:150-205`).
- Card-scope URL link (the yellow diamond) = `upsertCardLinkImpl(token, { cardId, url, color })` (`actions/links.ts:26`), one per card.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/pma/clients/gemini.ts` (modify) | add optional PDF `files` to the structured call (additive; PMA unaffected) |
| `lib/plan-import/types.ts` (create) | `ProjectPlan` TS type + genai `Schema` + Zod `ProjectPlanSchema` |
| `lib/plan-import/extract.ts` (create) | `extractPlanFromPdf(bytes) → ProjectPlan` |
| `lib/plan-import/drive-docs.ts` (create) | deliverable-doc HTML + find-or-create folder + `createDeliverableDoc` + `probeFolder` |
| `lib/plan-import/build.ts` (create) | `buildWorkspaceFromPlan(token, plan, driveFolderId?)` — the `*Impl` chain |
| `actions/plan-import.ts` (create) | `buildWorkspaceFromPlan` server action (auth + Zod + delegate) |
| `app/api/import-plan/extract/route.ts` (create) | POST route handler: receive PDF → `extractPlanFromPdf` |
| `app/(app)/import-plan/page.tsx` (create) | wizard shell (server page, `requireUser`) |
| `components/import-plan/*` (create) | `ImportWizard`, `UploadStep`, `ReviewStep`, `BuildStep` |
| `scripts/plan-import/extract-smoke.ts` (create) | run extraction against a real bando PDF |

---

## Task 1: Gemini client — carry a PDF part

**Files:**
- Modify: `lib/pma/clients/gemini.ts`
- Test: `lib/pma/clients/gemini-contents.test.ts`

Extract a pure `buildContents()` helper (testable without the SDK) and add an optional `files` field. PMA's text-only calls produce the identical `contents` they do today.

- [ ] **Step 1: Write the failing test**

```ts
// lib/pma/clients/gemini-contents.test.ts
import { describe, it, expect } from "vitest";
import { buildContents } from "./gemini";

describe("buildContents", () => {
  it("returns the bare prompt string when no files", () => {
    expect(buildContents("hello", undefined)).toBe("hello");
  });

  it("returns inlineData parts + text when files present", () => {
    const out = buildContents("extract", [
      { mimeType: "application/pdf", data: "QUJD" },
    ]);
    expect(out).toEqual([
      { inlineData: { mimeType: "application/pdf", data: "QUJD" } },
      { text: "extract" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pma/clients/gemini-contents.test.ts`
Expected: FAIL — `buildContents` is not exported.

- [ ] **Step 3: Implement the change**

In `lib/pma/clients/gemini.ts`, add the `files` field to `StructuredInput`, add `buildContents`, and use it in `generateStructured`:

```ts
export type StructuredInput = {
  model: GeminiModel;
  systemInstruction?: string;
  prompt: string;
  responseSchema: Schema;
  temperature?: number;
  // Optional binary parts (e.g. a PDF) sent alongside the prompt. When present
  // the request becomes multimodal; when absent behaviour is unchanged.
  files?: { mimeType: string; data: string }[]; // data = base64
};

// Pure: build the `contents` arg. Text-only → the bare string (unchanged
// behaviour for PMA). With files → inlineData parts followed by the text part.
export function buildContents(
  prompt: string,
  files: { mimeType: string; data: string }[] | undefined,
):
  | string
  | (
      | { inlineData: { mimeType: string; data: string } }
      | { text: string }
    )[] {
  if (!files || files.length === 0) return prompt;
  return [...files.map((f) => ({ inlineData: f })), { text: prompt }];
}
```

Then in `generateStructured`, replace `contents: input.prompt` with:

```ts
    contents: buildContents(input.prompt, input.files),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/pma/clients/gemini-contents.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
```bash
git add lib/pma/clients/gemini.ts lib/pma/clients/gemini-contents.test.ts
git commit -m "feat(gemini): optional PDF parts in generateStructured (PMA unchanged)"
```

---

## Task 2: ProjectPlan types, genai Schema, Zod schema

**Files:**
- Create: `lib/plan-import/types.ts`
- Test: `lib/plan-import/types.test.ts`

One source of truth for the extractor (genai `Schema`), the builder (TS type), and the server action (Zod).

- [ ] **Step 1: Write the failing test**

```ts
// lib/plan-import/types.test.ts
import { describe, it, expect } from "vitest";
import { ProjectPlanSchema, PROJECT_PLAN_GENAI_SCHEMA } from "./types";

const valid = {
  workspaceName: "AEGIS — Project Plan",
  parentBoardTitle: "AEGIS · Project Plan",
  workPackages: [
    {
      code: "WP1",
      title: "WP1 — Requirements",
      option: "RI",
      start: "2026-01-01",
      end: "2026-06-30",
      description: "…",
      lead: "INNOVINA",
      tasks: [{ title: "T1.1 — SOTA", description: "…" }],
      deliverables: [
        { title: "D1.1 — Requirements", taskIndex: 0, due: "2026-06-30", month: 6, description: "…" },
      ],
    },
  ],
  milestones: [{ name: "M6 — Baseline", date: "2026-06-30", description: "…" }],
};

describe("ProjectPlanSchema", () => {
  it("accepts a valid plan", () => {
    expect(ProjectPlanSchema.parse(valid)).toMatchObject({ workspaceName: "AEGIS — Project Plan" });
  });

  it("rejects an invalid option enum", () => {
    const bad = { ...valid, workPackages: [{ ...valid.workPackages[0], option: "XX" }] };
    expect(() => ProjectPlanSchema.parse(bad)).toThrow();
  });

  it("rejects a deliverable taskIndex that is not an integer", () => {
    const wp = { ...valid.workPackages[0], deliverables: [{ ...valid.workPackages[0].deliverables[0], taskIndex: 1.5 }] };
    expect(() => ProjectPlanSchema.parse({ ...valid, workPackages: [wp] })).toThrow();
  });

  it("exposes a genai object schema", () => {
    expect(PROJECT_PLAN_GENAI_SCHEMA.type).toBe("object");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/plan-import/types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/plan-import/types.ts
import { z } from "zod";
import { Type, type Schema } from "@google/genai";

// "YYYY-MM-DD". Kept permissive (the review UI is the real gate); we only
// guarantee a parseable shape for the builder.
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const DeliverableSchema = z.object({
  title: z.string().min(1),
  taskIndex: z.number().int().nonnegative(),
  due: DateStr,
  month: z.number().int().nonnegative(),
  description: z.string().default(""),
});

export const TaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
});

export const WorkPackageSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  option: z.enum(["RI", "SS", "RI+SS"]),
  start: DateStr,
  end: DateStr,
  description: z.string().default(""),
  lead: z.string().optional(),
  tasks: z.array(TaskSchema),
  deliverables: z.array(DeliverableSchema),
});

export const MilestoneSchema = z.object({
  name: z.string().min(1),
  date: DateStr,
  description: z.string().default(""),
});

export const ProjectPlanSchema = z.object({
  workspaceName: z.string().min(1),
  parentBoardTitle: z.string().min(1),
  workPackages: z.array(WorkPackageSchema),
  milestones: z.array(MilestoneSchema),
});

export type ProjectPlan = z.infer<typeof ProjectPlanSchema>;
export type WorkPackage = z.infer<typeof WorkPackageSchema>;

// genai response schema — the contract Gemini fills. Mirrors ProjectPlanSchema.
export const PROJECT_PLAN_GENAI_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    workspaceName: { type: Type.STRING },
    parentBoardTitle: { type: Type.STRING },
    workPackages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          code: { type: Type.STRING },
          title: { type: Type.STRING },
          option: { type: Type.STRING, enum: ["RI", "SS", "RI+SS"] },
          start: { type: Type.STRING },
          end: { type: Type.STRING },
          description: { type: Type.STRING },
          lead: { type: Type.STRING },
          tasks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
              },
              required: ["title", "description"],
            },
          },
          deliverables: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                taskIndex: { type: Type.INTEGER },
                due: { type: Type.STRING },
                month: { type: Type.INTEGER },
                description: { type: Type.STRING },
              },
              required: ["title", "taskIndex", "due", "month", "description"],
            },
          },
        },
        required: ["code", "title", "option", "start", "end", "description", "tasks", "deliverables"],
      },
    },
    milestones: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          date: { type: Type.STRING },
          description: { type: Type.STRING },
        },
        required: ["name", "date", "description"],
      },
    },
  },
  required: ["workspaceName", "parentBoardTitle", "workPackages", "milestones"],
};
```

> If `Type` is not exported by the installed `@google/genai`, replace `Type.OBJECT` etc. with the string literals `"object"`, `"array"`, `"string"`, `"integer"` and drop the `Type` import — the SDK accepts both. Verify with `npx tsc --noEmit`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/plan-import/types.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
```bash
git add lib/plan-import/types.ts lib/plan-import/types.test.ts
git commit -m "feat(plan-import): ProjectPlan types + genai + zod schema"
```

---

## Task 3: Extract a plan from a PDF

**Files:**
- Create: `lib/plan-import/extract.ts`
- Test: `lib/plan-import/extract.test.ts`

`extractPlanFromPdf(bytes)` base64s the PDF, calls the (now PDF-capable) Gemini client with the extraction prompt + schema, and Zod-parses the result.

- [ ] **Step 1: Write the failing test**

```ts
// lib/plan-import/extract.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateStructured = vi.fn();
vi.mock("@/lib/pma/clients/gemini", () => ({ generateStructured }));

import { extractPlanFromPdf } from "./extract";

const fixture = {
  workspaceName: "X — Project Plan",
  parentBoardTitle: "X · Project Plan",
  workPackages: [
    { code: "WP1", title: "WP1", option: "RI", start: "2026-01-01", end: "2026-06-30",
      description: "d", tasks: [{ title: "T1.1", description: "d" }],
      deliverables: [{ title: "D1.1", taskIndex: 0, due: "2026-06-30", month: 6, description: "d" }] },
  ],
  milestones: [{ name: "M6", date: "2026-06-30", description: "d" }],
};

beforeEach(() => generateStructured.mockReset());

describe("extractPlanFromPdf", () => {
  it("sends the PDF as a base64 file part and returns the parsed plan", async () => {
    generateStructured.mockResolvedValue(fixture);
    const plan = await extractPlanFromPdf(Buffer.from("PDFBYTES"));
    expect(plan.workspaceName).toBe("X — Project Plan");
    const arg = generateStructured.mock.calls[0][0];
    expect(arg.model).toBe("gemini-2.5-flash");
    expect(arg.files[0]).toEqual({
      mimeType: "application/pdf",
      data: Buffer.from("PDFBYTES").toString("base64"),
    });
  });

  it("throws when the model returns a structurally invalid plan", async () => {
    generateStructured.mockResolvedValue({ workspaceName: "" });
    await expect(extractPlanFromPdf(Buffer.from("x"))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/plan-import/extract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/plan-import/extract.ts
import "server-only";

import { generateStructured } from "@/lib/pma/clients/gemini";
import { ProjectPlanSchema, PROJECT_PLAN_GENAI_SCHEMA, type ProjectPlan } from "./types";

const EXTRACTION_PROMPT = `You are reading a project-plan / grant document (a "bando",
"Relazione tecnica" or "Piano di Lavoro"), often in Italian. Extract its structure as JSON
matching the provided schema.

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

export async function extractPlanFromPdf(pdfBytes: Buffer): Promise<ProjectPlan> {
  const raw = await generateStructured<unknown>({
    model: "gemini-2.5-flash",
    prompt: EXTRACTION_PROMPT,
    responseSchema: PROJECT_PLAN_GENAI_SCHEMA,
    files: [{ mimeType: "application/pdf", data: pdfBytes.toString("base64") }],
    temperature: 0,
  });
  // The review UI lets the user fix anything; here we only guarantee a
  // structurally valid plan for the builder. Zod throws on a malformed shape.
  return ProjectPlanSchema.parse(raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/plan-import/extract.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
```bash
git add lib/plan-import/extract.ts lib/plan-import/extract.test.ts
git commit -m "feat(plan-import): extractPlanFromPdf via Gemini flash"
```

---

## Task 4: Drive deliverable docs

**Files:**
- Create: `lib/plan-import/drive-docs.ts`
- Test: `lib/plan-import/drive-docs.test.ts`

Pure HTML builder (unit-tested) + find-or-create folder hierarchy + `createDeliverableDoc` + `probeFolder` (the latter three reuse `lib/pma/clients/drive.ts`; covered by the smoke script, not CI).

- [ ] **Step 1: Write the failing test**

```ts
// lib/plan-import/drive-docs.test.ts
import { describe, it, expect } from "vitest";
import { deliverableDocHtml } from "./drive-docs";

describe("deliverableDocHtml", () => {
  it("renders title, subtitle and a section skeleton, escaping HTML", () => {
    const html = deliverableDocHtml({
      title: "D1.1 — A & B <test>",
      subtitle: "INNOVINA · M6",
    });
    expect(html).toContain("<h1>D1.1 — A &amp; B &lt;test&gt;</h1>");
    expect(html).toContain("INNOVINA · M6");
    expect(html).toContain("Executive summary");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/plan-import/drive-docs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/plan-import/drive-docs.ts
import "server-only";

import { listFolder, createFolder, createDoc } from "@/lib/pma/clients/drive";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// HTML body uploaded as a native Google Doc (Drive converts text/html). Replaces
// the CLI's .docx template + zipfile placeholder-patch entirely.
export function deliverableDocHtml(input: { title: string; subtitle: string }): string {
  const t = esc(input.title);
  const s = esc(input.subtitle);
  return [
    `<h1>${t}</h1>`,
    `<p><i>${s}</i></p>`,
    `<h2>Executive summary</h2><p></p>`,
    `<h2>Scope</h2><p></p>`,
    `<h2>Content</h2><p></p>`,
    `<h2>References</h2><p></p>`,
  ].join("\n");
}

// find-or-create a child folder by name under parentId (cached per build).
async function ensureFolder(
  cache: Map<string, string>,
  parentId: string,
  name: string,
): Promise<string> {
  const key = `${parentId}/${name}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const existing = (await listFolder(parentId)).find(
    (f) => f.name === name && f.mimeType === "application/vnd.google-apps.folder",
  );
  const id = existing ? existing.id : (await createFolder(name, parentId)).id;
  cache.set(key, id);
  return id;
}

export type DriveDocsClient = {
  createDeliverableDoc(input: {
    wpTitle: string;
    deliverableTitle: string;
    subtitle: string;
  }): Promise<{ webViewLink: string }>;
};

// Build a per-import Drive client rooted at folderId. Layout:
//   <folderId>/<WP title>/Deliverables/<deliverable doc>
export function makeDriveDocsClient(folderId: string): DriveDocsClient {
  const folderCache = new Map<string, string>();
  return {
    async createDeliverableDoc({ wpTitle, deliverableTitle, subtitle }) {
      const wpFolder = await ensureFolder(folderCache, folderId, wpTitle);
      const delFolder = await ensureFolder(folderCache, wpFolder, "Deliverables");
      const { webViewLink } = await createDoc({
        name: deliverableTitle,
        parentId: delFolder,
        content: deliverableDocHtml({ title: deliverableTitle, subtitle }),
      });
      return { webViewLink };
    },
  };
}

// Fail-fast probe: confirm the SA can read the folder before any build write.
// Throws if the folder is missing / not shared with the service account.
export async function probeFolder(folderId: string): Promise<void> {
  await listFolder(folderId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/plan-import/drive-docs.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
```bash
git add lib/plan-import/drive-docs.ts lib/plan-import/drive-docs.test.ts
git commit -m "feat(plan-import): native Google Doc per deliverable from HTML"
```

---

## Task 5: Build the workspace from a plan

**Files:**
- Create: `lib/plan-import/build.ts`
- Test: `tests/integration/plan-import-build.test.ts`

The core: chain the `*Impl` functions under the user's JWT, with the `seedStep`/`SeedResult` partial-failure contract. Cards are created then typed via `updateCardImpl`. Lists are read back from each board (both `createBoardImpl(seedDefaultLists)` and `createSubboardImpl` auto-seed the 3 `DEFAULT_LIST_TEMPLATES`).

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/plan-import-build.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { workspaces, boards, cards, links } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { buildWorkspaceFromPlan } from "@/lib/plan-import/build";
import type { ProjectPlan } from "@/lib/plan-import/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
  const { data } = await service.auth.admin.createUser({ email, password: "passw0rd!", email_confirm: true });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

const plan: ProjectPlan = {
  workspaceName: "Test Plan WS",
  parentBoardTitle: "Test · Plan",
  workPackages: [
    {
      code: "WP1", title: "WP1 — Reqs", option: "RI", start: "2026-01-01", end: "2026-06-30",
      description: "d", lead: "INNOVINA",
      tasks: [{ title: "T1.1", description: "d" }, { title: "T1.2", description: "d" }],
      deliverables: [{ title: "D1.1 — Reqs doc", taskIndex: 0, due: "2026-06-30", month: 6, description: "d" }],
    },
    {
      code: "WP2", title: "WP2 — Build", option: "SS", start: "2026-07-01", end: "2026-10-31",
      description: "d",
      tasks: [{ title: "T2.1", description: "d" }],
      deliverables: [{ title: "D2.1 — Build doc", taskIndex: 0, due: "2026-10-31", month: 10, description: "d" }],
    },
  ],
  milestones: [{ name: "M6 — Baseline", date: "2026-06-30", description: "d" }],
};

describe("buildWorkspaceFromPlan", () => {
  it("builds workspace, sub-boards, typed cards, deliverable links and milestones", async () => {
    const u = await makeUser("planbuild");
    const res = await buildWorkspaceFromPlan(u.jwt, plan); // no Drive folder → placeholder links
    expect(res.ok).toBe(true);
    expect(res.workspaceId).toBeTruthy();
    const wsId = res.workspaceId!;

    await dbAsUser(u.jwt, async (tx) => {
      const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, wsId));
      expect(ws.name).toBe("Test Plan WS");

      const bs = await tx.select().from(boards).where(eq(boards.workspaceId, wsId));
      expect(bs.length).toBe(3); // 1 parent + 2 sub-boards
      expect(bs.filter((b) => b.parentBoardId !== null).length).toBe(2);

      const boardIds = bs.map((b) => b.id);
      const allCards = await tx.select().from(cards).where(inArray(cards.boardId, boardIds));
      // 2 anchors (task) + 3 tasks (task) + 2 deliverables (subtask) + 1 milestone = 8
      expect(allCards.length).toBe(8);
      expect(allCards.filter((c) => c.type === "task").length).toBe(5);
      expect(allCards.filter((c) => c.type === "subtask").length).toBe(2);
      expect(allCards.filter((c) => c.type === "milestone").length).toBe(1);

      // Each deliverable got a card-scope URL link (placeholder here — no Drive folder).
      const ls = await tx.select().from(links).where(eq(links.workspaceId, wsId));
      expect(ls.filter((l) => l.scope === "card").length).toBe(2);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/plan-import-build.test.ts`
Expected: FAIL — `buildWorkspaceFromPlan` not found.

- [ ] **Step 3: Implement**

```ts
// lib/plan-import/build.ts
import "server-only";

import { dbAsUser } from "@/lib/db/client";
import { lists as listsTable } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createSubboardImpl } from "@/actions/boards";
import { setListStatusKindImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";
import { upsertCardLinkImpl } from "@/actions/links";
import { createMilestoneImpl } from "@/actions/milestones";

import type { ProjectPlan } from "./types";
import { makeDriveDocsClient, probeFolder, type DriveDocsClient } from "./drive-docs";

const PLACEHOLDER_LINK_URL = "https://www.corriere.it";
const LINK_COLOR = "#facc15";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub as string;
}

export type BuildFailure = { step: string; message: string };
export type BuildResult = {
  workspaceId: string | null;
  ok: boolean;
  partial: boolean;
  failures: BuildFailure[];
};

async function step<T>(failures: BuildFailure[], name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    failures.push({ step: name, message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

// Both createBoardImpl(seedDefaultLists) and createSubboardImpl auto-seed the 3
// DEFAULT_LIST_TEMPLATES (Todo / In Progress / Done) but return only the board.
// Read them back in position order so we can target the Todo list and stamp
// status_kind (the auto-seeded sub-board lists have a null status_kind).
async function boardListsByPosition(token: string, boardId: string) {
  return dbAsUser(token, (tx) =>
    tx
      .select({ id: listsTable.id, statusKind: listsTable.statusKind })
      .from(listsTable)
      .where(eq(listsTable.boardId, boardId))
      .orderBy(asc(listsTable.position)),
  );
}

const STATUS_BY_INDEX = ["todo", "in_progress", "done"] as const;

async function ensureStatusKinds(token: string, boardId: string): Promise<string> {
  const rows = await boardListsByPosition(token, boardId);
  for (let i = 0; i < rows.length && i < STATUS_BY_INDEX.length; i++) {
    if (rows[i].statusKind !== STATUS_BY_INDEX[i]) {
      await setListStatusKindImpl(token, { id: rows[i].id, statusKind: STATUS_BY_INDEX[i] });
    }
  }
  return rows[0].id; // the Todo list
}

export async function buildWorkspaceFromPlan(
  token: string,
  plan: ProjectPlan,
  driveFolderId?: string,
): Promise<BuildResult> {
  const failures: BuildFailure[] = [];
  const userId = decodeSub(token);

  // Drive fail-fast: if a folder was given but the SA cannot read it, drop to
  // placeholder links rather than aborting the whole import.
  let drive: DriveDocsClient | null = null;
  if (driveFolderId) {
    const ok = await step(failures, "drive-probe", async () => { await probeFolder(driveFolderId); return true; });
    if (ok) drive = makeDriveDocsClient(driveFolderId);
  }

  const ws = await step(failures, "workspace", () => createWorkspaceImpl(token, { name: plan.workspaceName }));
  if (!ws) return { workspaceId: null, ok: false, partial: false, failures };

  const parent = await step(failures, "parent-board", () =>
    createBoardImpl(token, {
      workspaceId: ws.id,
      title: plan.parentBoardTitle,
      backgroundKind: "color",
      backgroundValue: "#0f0f12",
      seedDefaultLists: true,
    }),
  );
  if (!parent) return { workspaceId: ws.id, ok: false, partial: true, failures };

  const parentTodo = await ensureStatusKinds(token, parent.id);

  for (const wp of plan.workPackages) {
    // 1. WP anchor card on the parent board.
    const anchor = await step(failures, `anchor:${wp.code}`, async () => {
      const c = await createCardImpl(token, {
        listId: parentTodo,
        title: wp.title,
        startDate: wp.start,
        targetDate: wp.end,
        ownerId: null,
      });
      await updateCardImpl(token, {
        id: c.id,
        type: "task",
        description: `**Work Package** · ${wp.option}${wp.lead ? ` · Leader ${wp.lead}` : ""}\n\n${wp.description}`,
      });
      return c;
    });
    if (!anchor) continue;

    // 2. Sub-board anchored 1:1 to the anchor card.
    const sub = await step(failures, `subboard:${wp.code}`, () =>
      createSubboardImpl(token, { parentBoardId: parent.id, parentCardId: anchor.id, title: wp.title }),
    );
    if (!sub) continue;
    const subTodo = await ensureStatusKinds(token, sub.id);

    // 3. Task cards.
    const taskCards: { id: string }[] = [];
    for (const [i, t] of wp.tasks.entries()) {
      const tc = await step(failures, `task:${wp.code}.${i}`, async () => {
        const c = await createCardImpl(token, { listId: subTodo, title: t.title, startDate: wp.start, targetDate: wp.end, ownerId: null });
        await updateCardImpl(token, { id: c.id, type: "task", description: `**${wp.option}**\n\n${t.description}` });
        return c;
      });
      taskCards.push(tc ?? { id: "" });
    }

    // 4. Deliverable subtasks + a card-scope link (Drive doc or placeholder).
    for (const [i, d] of wp.deliverables.entries()) {
      await step(failures, `deliverable:${wp.code}.${i}`, async () => {
        const parentTask = taskCards[d.taskIndex] ?? taskCards[0];
        const startOfDueMonth = `${d.due.slice(0, 8)}01`;
        const dc = await createCardImpl(token, {
          listId: subTodo,
          title: d.title,
          startDate: startOfDueMonth,
          targetDate: d.due,
          parentCardId: parentTask?.id || null,
          ownerId: null,
        });
        await updateCardImpl(token, {
          id: dc.id,
          type: "subtask",
          parentCardId: parentTask?.id || null,
          description: `**Deliverable** · ${wp.code} · M${d.month}\n\n${d.description}`,
        });

        let url = PLACEHOLDER_LINK_URL;
        if (drive) {
          const { webViewLink } = await drive.createDeliverableDoc({
            wpTitle: wp.title,
            deliverableTitle: d.title,
            subtitle: [wp.lead, `M${d.month}`].filter(Boolean).join(" · "),
          });
          if (webViewLink) url = webViewLink;
        }
        await upsertCardLinkImpl(token, { cardId: dc.id, url, color: LINK_COLOR });
      });
    }
  }

  // 5. Plan milestones pinned to the parent board.
  for (const [i, m] of plan.milestones.entries()) {
    await step(failures, `milestone:${i}`, () =>
      createMilestoneImpl(token, {
        workspaceId: ws.id,
        boardId: parent.id,
        name: m.name,
        date: `${m.date}T12:00:00Z`,
        description: m.description,
        createdBy: userId,
      }),
    );
  }

  return { workspaceId: ws.id, ok: failures.length === 0, partial: failures.length > 0, failures };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/plan-import-build.test.ts`
Expected: PASS. (Requires local Supabase running, same as `seed-demo.test.ts`.)

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
```bash
git add lib/plan-import/build.ts tests/integration/plan-import-build.test.ts
git commit -m "feat(plan-import): RLS-safe workspace builder from a ProjectPlan"
```

---

## Task 6: Server action

**Files:**
- Create: `actions/plan-import.ts`

Thin boundary: auth + Zod-validate + delegate. (Auth/session needs request context, so it's exercised end-to-end via the wizard, not a unit test — `build.ts` carries the core test.)

- [ ] **Step 1: Implement**

```ts
// actions/plan-import.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getSessionToken } from "@/lib/auth";
import { ProjectPlanSchema } from "@/lib/plan-import/types";
import { buildWorkspaceFromPlan } from "@/lib/plan-import/build";

export async function buildWorkspaceFromPlanAction(input: {
  plan: unknown;
  driveFolderId?: string;
}) {
  await requireUser();
  const token = (await getSessionToken())!;
  const plan = ProjectPlanSchema.parse(input.plan);
  const folderId = input.driveFolderId?.trim() || undefined;
  const result = await buildWorkspaceFromPlan(token, plan, folderId);
  revalidatePath("/");
  return result;
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
```bash
git add actions/plan-import.ts
git commit -m "feat(plan-import): buildWorkspaceFromPlan server action"
```

---

## Task 7: Extract route handler

**Files:**
- Create: `app/api/import-plan/extract/route.ts`
- Test: `app/api/import-plan/extract/size.test.ts`

Route handlers can receive `File` (server actions can't). Extract the size guard as a pure, tested helper.

- [ ] **Step 1: Write the failing test**

```ts
// app/api/import-plan/extract/size.test.ts
import { describe, it, expect } from "vitest";
import { MAX_PDF_BYTES, checkPdfSize } from "./size";

describe("checkPdfSize", () => {
  it("accepts a small PDF", () => {
    expect(checkPdfSize(1_000)).toBeNull();
  });
  it("rejects over the cap", () => {
    expect(checkPdfSize(MAX_PDF_BYTES + 1)).toMatch(/too large/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/import-plan/extract/size.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper + the route**

```ts
// app/api/import-plan/extract/size.ts
export const MAX_PDF_BYTES = 15 * 1024 * 1024; // inline Gemini cap (v1)

export function checkPdfSize(bytes: number): string | null {
  if (bytes > MAX_PDF_BYTES) {
    return `PDF is too large (${(bytes / 1024 / 1024).toFixed(1)} MB; max ${MAX_PDF_BYTES / 1024 / 1024} MB). Split it or use a smaller export.`;
  }
  return null;
}
```

```ts
// app/api/import-plan/extract/route.ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { extractPlanFromPdf } from "@/lib/plan-import/extract";
import { checkPdfSize } from "./size";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  await requireUser();
  const form = await req.formData();
  const file = form.get("pdf");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No PDF uploaded." }, { status: 400 });
  }
  const tooBig = checkPdfSize(file.size);
  if (tooBig) return NextResponse.json({ error: tooBig }, { status: 413 });

  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const plan = await extractPlanFromPdf(bytes);
    return NextResponse.json({ plan });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Extraction failed." },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run app/api/import-plan/extract/size.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add app/api/import-plan/extract/route.ts app/api/import-plan/extract/size.ts app/api/import-plan/extract/size.test.ts
git commit -m "feat(plan-import): PDF extract route handler"
```

---

## Task 8: Wizard UI

**Files:**
- Create: `app/(app)/import-plan/page.tsx`
- Create: `components/import-plan/import-wizard.tsx`
- Create: `components/import-plan/upload-step.tsx`
- Create: `components/import-plan/review-step.tsx`
- Create: `components/import-plan/build-step.tsx`

Match existing component conventions (look at `components/settings/seed-rich-button.tsx` for the `useTransition` + server-action + `router.push` pattern, and an existing form component for input styling). The page is a server component that calls `requireUser()`; the wizard is a client component holding step state.

- [ ] **Step 1: Server page**

```tsx
// app/(app)/import-plan/page.tsx
import { requireUser } from "@/lib/auth";
import { ImportWizard } from "@/components/import-plan/import-wizard";

export default async function ImportPlanPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Import a project plan</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload a project-plan PDF. We extract the work packages, tasks, deliverables and
        milestones; you review and edit them; then we build a new workspace.
      </p>
      <ImportWizard />
    </div>
  );
}
```

- [ ] **Step 2: Wizard shell (client, holds step + plan state)**

```tsx
// components/import-plan/import-wizard.tsx
"use client";

import { useState } from "react";
import type { ProjectPlan } from "@/lib/plan-import/types";
import { UploadStep } from "./upload-step";
import { ReviewStep } from "./review-step";
import { BuildStep } from "./build-step";

type Phase = "upload" | "review" | "build";

export function ImportWizard() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [driveFolderId, setDriveFolderId] = useState("");

  return (
    <div className="mt-6 space-y-4">
      {phase === "upload" && (
        <UploadStep
          driveFolderId={driveFolderId}
          onDriveFolderId={setDriveFolderId}
          onExtracted={(p) => { setPlan(p); setPhase("review"); }}
        />
      )}
      {phase === "review" && plan && (
        <ReviewStep
          plan={plan}
          onChange={setPlan}
          onBack={() => setPhase("upload")}
          onConfirm={() => setPhase("build")}
        />
      )}
      {phase === "build" && plan && (
        <BuildStep plan={plan} driveFolderId={driveFolderId} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Upload step (POST to the route handler)**

```tsx
// components/import-plan/upload-step.tsx
"use client";

import { useState } from "react";
import type { ProjectPlan } from "@/lib/plan-import/types";

export function UploadStep({
  driveFolderId,
  onDriveFolderId,
  onExtracted,
}: {
  driveFolderId: string;
  onDriveFolderId: (v: string) => void;
  onExtracted: (plan: ProjectPlan) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.set("pdf", file);
      const res = await fetch("/api/import-plan/extract", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Extraction failed.");
      onExtracted(json.plan as ProjectPlan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium">Project-plan PDF</label>
      <input
        type="file"
        accept="application/pdf"
        disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      <div>
        <label className="block text-sm font-medium">Google Drive folder for deliverable docs (optional)</label>
        <input
          type="text"
          value={driveFolderId}
          onChange={(e) => onDriveFolderId(e.target.value)}
          placeholder="Drive folder ID or link"
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Share the folder with the service account as Editor, then paste its link. Leave blank to
          skip Drive docs (deliverables get a placeholder link you can edit later).
        </p>
      </div>
      {busy && <p className="text-sm">Extracting… this can take up to a minute for a long PDF.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

> If the field accepts a full Drive link, normalize it to the folder id in `build.ts`/the action before use (e.g. the `…/folders/<id>` segment). Keep a small `parseDriveFolderId(input)` helper if you add link support; the id-only path needs none.

- [ ] **Step 4: Review step (editable plan)**

Render the plan as editable fields. Minimum viable: workspace name + parent board title as text inputs; each WP as a card with editable title/option/dates/description and nested editable task and deliverable rows (add/remove buttons); milestones list. All edits call `onChange` with an updated `ProjectPlan` clone. Keep it a controlled form over the `plan` prop. (No new types — it reads/writes `ProjectPlan` from Task 2.)

```tsx
// components/import-plan/review-step.tsx
"use client";

import type { ProjectPlan } from "@/lib/plan-import/types";

export function ReviewStep({
  plan, onChange, onBack, onConfirm,
}: {
  plan: ProjectPlan;
  onChange: (p: ProjectPlan) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  function setField<K extends keyof ProjectPlan>(k: K, v: ProjectPlan[K]) {
    onChange({ ...plan, [k]: v });
  }
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium">Workspace name</label>
        <input className="mt-1 w-full rounded border px-2 py-1 text-sm"
          value={plan.workspaceName} onChange={(e) => setField("workspaceName", e.target.value)} />
      </div>
      <div>
        <label className="block text-sm font-medium">Parent board title</label>
        <input className="mt-1 w-full rounded border px-2 py-1 text-sm"
          value={plan.parentBoardTitle} onChange={(e) => setField("parentBoardTitle", e.target.value)} />
      </div>

      <div className="space-y-3">
        {plan.workPackages.map((wp, wi) => (
          <details key={wi} className="rounded border p-3" open>
            <summary className="cursor-pointer text-sm font-medium">{wp.code} — {wp.title}</summary>
            <div className="mt-2 space-y-2 text-sm">
              <input className="w-full rounded border px-2 py-1" value={wp.title}
                onChange={(e) => {
                  const wps = [...plan.workPackages];
                  wps[wi] = { ...wp, title: e.target.value };
                  setField("workPackages", wps);
                }} />
              <p className="text-xs text-muted-foreground">
                {wp.option} · {wp.start} → {wp.end} · {wp.tasks.length} tasks · {wp.deliverables.length} deliverables
              </p>
              {/* TASKS + DELIVERABLES: render each as an editable row with add/remove,
                  writing back a cloned ProjectPlan via setField("workPackages", …).
                  Follow this same clone-and-replace pattern. */}
            </div>
          </details>
        ))}
      </div>

      <div className="text-sm font-medium">Milestones: {plan.milestones.length}</div>

      <div className="flex gap-2">
        <button className="rounded border px-3 py-1 text-sm" onClick={onBack}>Back</button>
        <button className="rounded bg-black px-3 py-1 text-sm text-white" onClick={onConfirm}>
          Looks right — build workspace
        </button>
      </div>
    </div>
  );
}
```

> The task/deliverable/milestone editable rows follow the identical clone-and-replace pattern shown for the WP title. Implement them the same way; do not introduce new state shapes.

- [ ] **Step 5: Build step (call the action, route on success)**

```tsx
// components/import-plan/build-step.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectPlan } from "@/lib/plan-import/types";
import { buildWorkspaceFromPlanAction } from "@/actions/plan-import";

export function BuildStep({ plan, driveFolderId }: { plan: ProjectPlan; driveFolderId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"building" | "partial" | "error">("building");
  const [failures, setFailures] = useState<{ step: string; message: string }[]>([]);
  const [wsId, setWsId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await buildWorkspaceFromPlanAction({ plan, driveFolderId });
        if (cancelled) return;
        if (res.ok && res.workspaceId) { router.push(`/w/${res.workspaceId}/roadmap`); return; }
        setWsId(res.workspaceId); setFailures(res.failures); setStatus("partial");
      } catch (e) {
        if (!cancelled) { setFailures([{ step: "build", message: e instanceof Error ? e.message : "failed" }]); setStatus("error"); }
      }
    })();
    return () => { cancelled = true; };
  }, [plan, driveFolderId, router]);

  if (status === "building") return <p className="text-sm">Building your workspace…</p>;
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium">{status === "partial" ? "Built with some issues." : "Build failed."}</p>
      <ul className="list-disc pl-5 text-red-600">
        {failures.map((f, i) => <li key={i}>{f.step}: {f.message}</li>)}
      </ul>
      {wsId && (
        <button className="rounded border px-3 py-1" onClick={() => router.push(`/w/${wsId}/roadmap`)}>
          Open the partial workspace
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`
```bash
git add app/\(app\)/import-plan components/import-plan
git commit -m "feat(plan-import): import-plan wizard UI"
```

---

## Task 9: Extraction smoke script

**Files:**
- Create: `scripts/plan-import/extract-smoke.ts`

Mirrors `scripts/pma/gemini-smoke.ts` — run extraction against a real bando PDF and print the plan. Not in CI (needs `GEMINI_API_KEY`).

- [ ] **Step 1: Implement**

```ts
// scripts/plan-import/extract-smoke.ts
// Usage: GEMINI_API_KEY=… npx tsx scripts/plan-import/extract-smoke.ts path/to/bando.pdf
import { readFile } from "node:fs/promises";
import { extractPlanFromPdf } from "@/lib/plan-import/extract";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: extract-smoke.ts <pdf-path>");
  const bytes = await readFile(path);
  const plan = await extractPlanFromPdf(bytes);
  console.log(JSON.stringify(plan, null, 2));
  console.log(`\n${plan.workPackages.length} WP · ${plan.workPackages.reduce((n, w) => n + w.tasks.length, 0)} tasks · ${plan.workPackages.reduce((n, w) => n + w.deliverables.length, 0)} deliverables · ${plan.milestones.length} milestones`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it against a real bando (manual verification)**

Run: `GEMINI_API_KEY=… npx tsx scripts/plan-import/extract-smoke.ts <some-bando>.pdf`
Expected: a structured plan prints; eyeball that the WP/task/deliverable counts match the document.

- [ ] **Step 3: Commit**

```bash
git add scripts/plan-import/extract-smoke.ts
git commit -m "chore(plan-import): extraction smoke script"
```

---

## Final verification

- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run lint` clean.
- [ ] `npx vitest run lib/pma/clients/gemini-contents.test.ts lib/plan-import/types.test.ts lib/plan-import/extract.test.ts lib/plan-import/drive-docs.test.ts app/api/import-plan/extract/size.test.ts` all pass.
- [ ] `npx vitest run tests/integration/plan-import-build.test.ts` passes against local Supabase.
- [ ] Manual: `/import-plan` → upload a bando → review → build → lands on the roadmap with WP sub-boards, dated cards, deliverable links, milestones. With a shared Drive folder, deliverable links open native Google Docs titled after the deliverable.
- [ ] **Deploy-config follow-up (not code):** confirm `GEMINI_API_KEY` and `GOOGLE_SERVICE_ACCOUNT_JSON` are set in Vercel preview + prod, else extraction errors / Drive docs fall back to placeholder links.

---

## Notes on tier / review

This is Tier 2–3 (new upload route, paid external API, Drive writes) but the DB build is RLS-safe under the user's own JWT (no service-role). When executing, run it through `ai-dev-control` — the route handler and paid-API path warrant the verify gate. No DB migration is required.
