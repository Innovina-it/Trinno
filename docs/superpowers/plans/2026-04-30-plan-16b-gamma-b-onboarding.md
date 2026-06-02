# Plan #16b-γ-B — Onboarding (templates + seed + first-run tour)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Scope:** Reduce empty-app friction. New users land somewhere usable. Returning users teach themselves the UI.

## Tasks

### Task 1 — Board templates

`lib/board-templates.ts`:

```ts
export type BoardTemplate = {
  id: "blank" | "standup" | "bug_triage" | "okr_sprint";
  name: string;
  description: string;
  lists: { title: string; statusKind?: "todo"|"in_progress"|"review"|"done"|"blocked" }[];
  labels: { name: string; color: string }[];
};

export const BOARD_TEMPLATES: BoardTemplate[] = [
  { id: "blank", name: "Blank", description: "Empty board. Add your own lists.",
    lists: [], labels: [] },
  { id: "standup", name: "Daily standup", description: "Today / Yesterday / Blockers.",
    lists: [
      { title: "Yesterday", statusKind: "done" },
      { title: "Today", statusKind: "in_progress" },
      { title: "Blockers", statusKind: "blocked" },
    ],
    labels: [
      { name: "blocker", color: "#fafafa" },
      { name: "fyi", color: "#fafafa" },
    ],
  },
  { id: "bug_triage", name: "Bug triage", description: "Inbox / Triaging / In progress / Verifying / Closed.",
    lists: [
      { title: "Inbox", statusKind: "todo" },
      { title: "Triaging", statusKind: "todo" },
      { title: "In progress", statusKind: "in_progress" },
      { title: "Verifying", statusKind: "review" },
      { title: "Closed", statusKind: "done" },
    ],
    labels: [
      { name: "P0", color: "#fafafa" },
      { name: "P1", color: "#fafafa" },
      { name: "P2", color: "#fafafa" },
      { name: "regression", color: "#fafafa" },
    ],
  },
  { id: "okr_sprint", name: "OKR / Sprint", description: "Backlog → Sprint → In progress → Review → Done.",
    lists: [
      { title: "Backlog", statusKind: "todo" },
      { title: "This sprint", statusKind: "todo" },
      { title: "In progress", statusKind: "in_progress" },
      { title: "Review", statusKind: "review" },
      { title: "Done", statusKind: "done" },
    ],
    labels: [
      { name: "objective", color: "#fafafa" },
      { name: "key-result", color: "#fafafa" },
    ],
  },
];
```

### Task 2 — `createBoardFromTemplate` action

In `actions/boards.ts`, add:

```ts
export async function createBoardFromTemplateImpl(
  token: string,
  input: { workspaceId: string; title: string; backgroundKind: "color"|"image";
           backgroundValue: string; templateId: BoardTemplate["id"] },
): Promise<{ board: BoardRow; listIds: string[] }> {
  // 1. createBoardImpl(token, ...) → board
  // 2. For each list in template (in order): createListImpl with positionBetween logic
  // 3. For each label: createLabelImpl
  // 4. Update lists' statusKind via setListStatusKindImpl
  // Return board + listIds for navigation.
}
```

Validation: `CreateBoardFromTemplateInput` adds `templateId` (z.enum of template ids).

Wrapper `createBoardFromTemplate` calls impl + revalidatePath.

### Task 3 — Update CreateBoardDialog with template picker

Modify `components/workspace/create-board-dialog.tsx`:
- Add a stepped form: Step 1 picks template (cards rendered for each, click selects), Step 2 fills title + bg color.
- "Blank" is default + first.
- Submit calls `createBoardFromTemplate({ ..., templateId })`.
- Dialog header reflects step.

Tests: `tests/integration/board-templates.test.ts` — create from each template, assert lists + labels present + correct statusKind.

Commit: `feat(boards): templates picker + createBoardFromTemplate action`.

### Task 4 — Sample workspace seed

`actions/seed.ts`:

```ts
export async function seedDemoWorkspaceImpl(token: string): Promise<{ workspaceId: string }> {
  // Use createWorkspaceImpl with name "Demo Workspace"
  // Create board "Demo board" via createBoardFromTemplateImpl with template "okr_sprint"
  // Add 5 demo cards distributed across lists:
  //   - Card 1: title "Build auth flow", type epic, story_points 13, due_date +14d, start_date today, target_date +21d
  //   - Card 2: title "Wire login form", type story, parent=epic1, story_points 5, due +7d
  //   - Card 3: title "Add forgot-password", type subtask, parent=story1, story_points 2
  //   - Card 4: title "Bug: token expiry off by 1", type bug, P0 label
  //   - Card 5: title "Polish landing page", type task, story_points 3
  // Create one sprint "Sprint 1", planned, start tomorrow, end +14d. Assign cards 2-5 to it.
  // Create one component "Frontend".
  // Create one version v1.0 unreleased.
  // Create one personal dashboard "Demo dashboard" with gadgets:
  //   - count: open_cards (no workspace filter)
  //   - velocity (this workspace, n=6)
  //   - markdown_note: "## Welcome!\nThis is a seeded workspace..."
  // Return workspaceId for navigation.
}
```

Wrapper `seedDemoWorkspace`.

Validation: no input schema needed (all derived).

### Task 5 — Signup form: "Seed demo data" checkbox

Modify `components/auth/signup-form.tsx`:
- Add a checkbox `seedDemo` (default checked).
- After confirmation succeeds (in `app/(auth)/auth/callback/route.ts` GET handler), if the URL carries `seed=1` query param OR a cookie set during signup, call `seedDemoWorkspaceImpl` server-side and redirect to `/w/{seededWsId}`.
- Implementation: signup form sets a session cookie `tr_seed_demo=1` on submit when checkbox is on. Callback reads cookie, calls seed if present, deletes cookie, redirects.

Test: `tests/integration/seed-demo.test.ts` — `seedDemoWorkspaceImpl(jwt)` returns workspaceId with all expected entities. Assertions on cards count, sprint count, dashboard count.

Commit: `feat(seed): seed demo workspace + signup checkbox`.

### Task 6 — First-run tour

DB:

```sql
-- 0039_user_onboarding.sql
alter table public.profiles
  add column onboarding_completed_at timestamptz;
```

Drizzle: `onboardingCompletedAt: timestamp(...)` on profiles.

Validation: `MarkOnboardingCompletedInput = z.object({})`.

Action `actions/onboarding.ts`:
- `markOnboardingCompletedImpl(token)` → UPDATE profiles set onboarding_completed_at = now() WHERE id = auth.uid().
- Wrapper.

Component `components/onboarding/tour-overlay.tsx` (client):

5 steps:
1. **Welcome** — full-bleed dim overlay, centered card. "Welcome to Trinnovina. 30 sec tour?" Skip / Next.
2. **Your workspace** — highlight workspace switcher in nav.
3. **Boards** — highlight "+ New board" or first board tile.
4. **Card modal** — instruct user to click any card → highlight subtask + linked-issues + dates sections.
5. **Roadmap & Dashboards** — highlight ROADMAP + DASHBOARDS nav links.

Each step: positioned tooltip (use simple absolute positioning + arrow). Next/Back/Skip buttons. On close (skip or finish): call `markOnboardingCompleted` + remove overlay.

Mount via `app/(app)/layout.tsx`: read `user.onboardingCompletedAt`. If null AND user has at least 1 workspace, render `<TourOverlay user={...} />`.

For unauthenticated routes / explicitly tour-disabled paths, no-op.

Test: `tests/integration/onboarding.test.ts` — `markOnboardingCompletedImpl` flips the column. RLS denies for other users.

Commit: `feat(onboarding): first-run tour overlay + completed flag on profiles`.

### Task 7 — Final verification

- `npx tsc --noEmit` clean.
- `npm run build` clean.
- `npm run test:unit` — ~136 expected (132 + 4 new).
- `npx playwright test` — 10 still green.

## Constraints

- Keep monochrome theme — no chroma in tour overlay.
- Tour overlay z-index must NOT block TopNav (so users can use the workspace switcher being highlighted).
- Seed action wraps in `dbAsUser` transaction — if any step fails, rollback (Supabase will rollback entire txn on error).
- `seed=1` query param is one option; cookie is more robust across the email confirmation hop. Use cookie.

## Self-Review Notes

- **Board template names + label colors** are monochrome (white only). Future user can re-color.
- **Demo workspace** is illustrative; users delete it via workspace settings.
- **First-run tour** is a single component, not framework — keeps deps minimal. Manual positioning rather than `floating-ui`.
- **Tour resume** post-skip: not supported (one-shot). User can always navigate manually.
