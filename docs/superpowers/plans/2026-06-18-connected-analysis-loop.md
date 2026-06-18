# Connected Analysis Loop — Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the documents plan-import creates actually analyzable, by reading the documents folder recursively, splitting each project into sibling `Documents/` (read) and `Reports/` (written) folders, and configuring + running analysis from one place.

**Architecture:** Reuse the existing PMA engine and the existing workspace `source`/`reports` links (no schema change). A new recursive Drive lister feeds `detect`; a provisioning helper creates `<project>/{Documents, Reports}`; the import wizard's `Auto | Manual` control is mounted on the Analysis page and sets both links in one action; plan-import provisions the same structure for new workspaces.

**Tech Stack:** Next.js App Router (server components + server actions), Drizzle, Supabase (RLS + service-role), `googleapis` Drive v3, vitest.

**Scope:** This is Plan 1 of 2. The per-type content adapter (PDF/Office analysis) and the per-workspace run lock are **Plan 2** (`2026-06-18-analysis-filetypes-and-lock.md`).

## Global Constraints

- Server-only modules carry `import "server-only"`; vitest tests MUST `vi.mock("server-only", () => ({}))`.
- vitest only includes `tests/**` and does NOT transform JSX — never write render tests for `.tsx`; verify UI via `tsc`/eslint (+ live/e2e). (See memory: trinno-vitest-no-jsx.)
- Run vitest through rtk proxy with JSON output (rtk mangles vitest console): `rtk proxy npx vitest run <path> --reporter=json --outputFile=/tmp/out.json`.
- Never `supabase db reset`. No new tables or columns in this plan.
- Drive reads use the existing service-account client (`lib/pma/clients/drive.ts`); never write to the `Documents/` tree, only to `Reports/`.
- Folder names are exactly `Documents` and `Reports`.
- Do not push; commit only.

---

### Task 1: Recursive Drive lister `listFolderTree`

**Files:**
- Modify: `lib/pma/clients/drive.ts` (add `listFolderTree` after `listFolder`, ~line 217)
- Test: `tests/unit/pma-drive-listfoldertree.test.ts`

**Interfaces:**
- Consumes: existing `listFolder(folderId): Promise<DriveFile[]>` and `DriveFile` (has `id`, `name`, `mimeType`).
- Produces: `listFolderTree(folderId: string, opts?: { skipNames?: string[] }): Promise<DriveFile[]>` — every non-folder file under `folderId` at any depth, skipping subfolders whose `name` is in `skipNames`. Folders themselves are not returned (only their contents).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/pma-drive-listfoldertree.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Mock the low-level googleapis client behind getDriveClient by mocking listFolder's
// dependency surface: we test listFolderTree by stubbing listFolder per-folder.
const listFolderMock = vi.fn();
vi.mock("@/lib/pma/clients/drive", async (orig) => {
  const actual = await orig<typeof import("@/lib/pma/clients/drive")>();
  return { ...actual, listFolder: listFolderMock };
});

import { listFolderTree } from "@/lib/pma/clients/drive";

const FOLDER = "application/vnd.google-apps.folder";
function file(id: string, name: string, mime = "application/vnd.google-apps.document") {
  return { id, name, mimeType: mime, modifiedTime: null, createdTime: null, headRevisionId: null, version: "1", lastModifiedBy: null };
}

describe("listFolderTree", () => {
  beforeEach(() => listFolderMock.mockReset());

  it("returns files at every depth and recurses into subfolders", async () => {
    listFolderMock.mockImplementation(async (id: string) => {
      if (id === "root") return [file("a", "a.doc"), file("sub", "WP1", FOLDER)];
      if (id === "sub") return [file("b", "b.doc")];
      return [];
    });
    const out = await listFolderTree("root");
    expect(out.map((f) => f.id).sort()).toEqual(["a", "b"]);
  });

  it("skips subfolders whose name is in skipNames", async () => {
    listFolderMock.mockImplementation(async (id: string) => {
      if (id === "root") return [file("a", "a.doc"), file("rep", "Reports", FOLDER)];
      if (id === "rep") return [file("r", "old-report.doc")];
      return [];
    });
    const out = await listFolderTree("root", { skipNames: ["Reports"] });
    expect(out.map((f) => f.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run tests/unit/pma-drive-listfoldertree.test.ts --reporter=json --outputFile=/tmp/t1.json`
Expected: FAIL — `listFolderTree is not a function`.

- [ ] **Step 3: Implement `listFolderTree`**

Add to `lib/pma/clients/drive.ts` directly after `listFolder`:

```ts
const FOLDER_MIME = "application/vnd.google-apps.folder";

// Recursively list every NON-folder file under `folderId`, at any depth. Folders
// whose name is in `skipNames` are not descended into (used to keep the Reports
// output folder out of the analysis scan). Folders themselves are not returned.
export async function listFolderTree(
  folderId: string,
  opts: { skipNames?: string[] } = {},
): Promise<DriveFile[]> {
  const skip = new Set(opts.skipNames ?? []);
  const out: DriveFile[] = [];
  const stack: string[] = [folderId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const f of await listFolder(current)) {
      if (f.mimeType === FOLDER_MIME) {
        if (!skip.has(f.name)) stack.push(f.id);
      } else {
        out.push(f);
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run tests/unit/pma-drive-listfoldertree.test.ts --reporter=json --outputFile=/tmp/t1.json`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pma/clients/drive.ts tests/unit/pma-drive-listfoldertree.test.ts
git commit -m "feat(pma): recursive listFolderTree with skip-by-name"
```

---

### Task 2: `detect` reads the folder recursively, skipping `Reports`

**Files:**
- Modify: `lib/pma/detect.ts` (the `listFolder(sourceFolderId)` call inside `detect`, ~line 172)
- Test: `tests/unit/pma-detect-recursive.test.ts`

**Interfaces:**
- Consumes: `listFolderTree` (Task 1).
- Produces: no signature change to `detect`; it now sees nested files and never the `Reports` subfolder.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/pma-detect-recursive.test.ts
import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));

const listFolderTreeMock = vi.fn();
vi.mock("@/lib/pma/clients/drive", () => ({
  listFolder: vi.fn(),
  listFolderTree: listFolderTreeMock,
  getFile: vi.fn(),
  listRevisions: vi.fn(),
}));

import { detect } from "@/lib/pma/detect";

function f(id: string, name: string) {
  return { id, name, mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-06-10T00:00:00Z", createdTime: "2026-06-01T00:00:00Z", headRevisionId: null, version: "1", lastModifiedBy: null };
}

describe("detect uses listFolderTree skipping Reports", () => {
  it("calls listFolderTree(sourceFolderId, { skipNames: ['Reports'] })", async () => {
    listFolderTreeMock.mockResolvedValue([f("a", "a.doc")]);
    await detect({ sourceFolderId: "root", pageToken: null, deliverableLinks: [], allFiles: true });
    expect(listFolderTreeMock).toHaveBeenCalledWith("root", { skipNames: ["Reports"] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run tests/unit/pma-detect-recursive.test.ts --reporter=json --outputFile=/tmp/t2.json`
Expected: FAIL — `detect` still calls `listFolder`, so the mock for `listFolderTree` is never called.

- [ ] **Step 3: Switch detect to the recursive lister**

In `lib/pma/detect.ts`: change the import to include `listFolderTree`, and replace the scan line.

```ts
// import line near top — add listFolderTree
import { listFolderTree } from "./clients/drive";
```

Replace (~line 172):

```ts
  const currentList = await listFolder(sourceFolderId);
```

with:

```ts
  // Recursive: plan-import nests deliverable Docs under Documents/<WP>/Deliverables/.
  // Skip the sibling/child Reports folder so analysis never re-reads its own output.
  const currentList = await listFolderTree(sourceFolderId, { skipNames: ["Reports"] });
```

Remove the now-unused `listFolder` import if nothing else in the file uses it (grep first: `grep -n "listFolder\b" lib/pma/detect.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run tests/unit/pma-detect-recursive.test.ts --reporter=json --outputFile=/tmp/t2.json`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
rtk proxy npx tsc --noEmit
git add lib/pma/detect.ts tests/unit/pma-detect-recursive.test.ts
git commit -m "feat(pma): detect scans the documents folder recursively, skipping Reports"
```

---

### Task 3: Write reports directly to the output (Reports) folder

**Files:**
- Modify: `lib/pma/output.ts` (`createReport`, remove the `analyses/` subfolder, ~lines 36, 81-91)
- Test: `tests/unit/pma-output-report.test.ts`

**Interfaces:**
- Produces: `createReport(outputFolderId, { name, content })` writes the Doc directly into `outputFolderId` (the Reports folder); `ensureSubfolder` and `ANALYSES_FOLDER` are removed.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/pma-output-report.test.ts
import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));

const createDoc = vi.fn().mockResolvedValue({ id: "doc1", webViewLink: "https://docs/doc1" });
vi.mock("@/lib/pma/clients/drive", () => ({
  createDoc, createFolder: vi.fn(), listFolder: vi.fn(), trashFile: vi.fn(),
}));

import { createReport } from "@/lib/pma/output";

describe("createReport", () => {
  it("writes the Doc directly into the output (Reports) folder", async () => {
    const r = await createReport("reportsFolder", { name: "Report", content: "<h1>x</h1>" });
    expect(createDoc).toHaveBeenCalledWith({ name: "Report", parentId: "reportsFolder", content: "<h1>x</h1>" });
    expect(r).toEqual({ id: "doc1", webViewLink: "https://docs/doc1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run tests/unit/pma-output-report.test.ts --reporter=json --outputFile=/tmp/t3.json`
Expected: FAIL — `createReport` currently calls `ensureSubfolder` (so `createFolder`/`listFolder` are invoked and `parentId` is the `analyses/` id, not `reportsFolder`).

- [ ] **Step 3: Simplify `createReport`**

In `lib/pma/output.ts`, delete `ANALYSES_FOLDER`, `findChildFolder`, and `ensureSubfolder` (and their now-unused imports `createFolder`, `listFolder` if nothing else uses them — grep first). Replace `createReport` with:

```ts
// Create a run report as a native Google Doc directly in the workspace's Reports
// (output) folder. Returns the new Doc id + webViewLink (the link the Analysis tab
// surfaces). The Reports folder is a SIBLING of Documents and is never scanned.
export async function createReport(
  outputFolderId: string,
  input: { name: string; content: string },
): Promise<{ id: string; webViewLink: string }> {
  return createDoc({ name: input.name, parentId: outputFolderId, content: input.content });
}
```

Keep `listOutput` and the `trashFile` re-export.

- [ ] **Step 4: Run + verify other output tests still pass**

Run: `rtk proxy npx vitest run tests/unit/pma-output-report.test.ts --reporter=json --outputFile=/tmp/t3.json`
Then run any existing output test: `rtk proxy npx vitest run tests/ --reporter=json --outputFile=/tmp/all.json` and confirm no regressions in `pma` suites.
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
rtk proxy npx tsc --noEmit
git add lib/pma/output.ts tests/unit/pma-output-report.test.ts
git commit -m "feat(pma): write reports directly to the Reports folder (drop analyses/ subfolder)"
```

---

### Task 4: `provisionProjectFolders` — create `<project>/{Documents, Reports}`

**Files:**
- Create: `lib/pma/provision.ts`
- Test: `tests/unit/pma-provision.test.ts`

**Interfaces:**
- Consumes: `createFolder(name, parentId): Promise<DriveFile>`, `listFolder(folderId): Promise<DriveFile[]>` from `lib/pma/clients/drive.ts`.
- Produces: `provisionProjectFolders(rootFolderId: string, projectName: string): Promise<{ projectFolderId: string; documentsFolderId: string; reportsFolderId: string }>` — find-or-create `<root>/<projectName>`, then find-or-create `Documents` and `Reports` inside it. Idempotent.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/pma-provision.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));

const listFolder = vi.fn();
const createFolder = vi.fn();
vi.mock("@/lib/pma/clients/drive", () => ({ listFolder, createFolder }));

import { provisionProjectFolders } from "@/lib/pma/provision";

const FOLDER = "application/vnd.google-apps.folder";
const fold = (id: string, name: string) => ({ id, name, mimeType: FOLDER, modifiedTime: null, createdTime: null, headRevisionId: null, version: "1", lastModifiedBy: null });

describe("provisionProjectFolders", () => {
  beforeEach(() => { listFolder.mockReset(); createFolder.mockReset(); });

  it("creates project + Documents + Reports when none exist", async () => {
    listFolder.mockResolvedValue([]); // nothing exists anywhere
    createFolder.mockImplementation(async (name: string) => fold(`${name}-id`, name));
    const r = await provisionProjectFolders("root", "AEGIS");
    expect(r).toEqual({ projectFolderId: "AEGIS-id", documentsFolderId: "Documents-id", reportsFolderId: "Reports-id" });
    expect(createFolder).toHaveBeenCalledWith("AEGIS", "root");
    expect(createFolder).toHaveBeenCalledWith("Documents", "AEGIS-id");
    expect(createFolder).toHaveBeenCalledWith("Reports", "AEGIS-id");
  });

  it("reuses existing folders (idempotent)", async () => {
    listFolder.mockImplementation(async (id: string) => {
      if (id === "root") return [fold("p", "AEGIS")];
      if (id === "p") return [fold("d", "Documents"), fold("r", "Reports")];
      return [];
    });
    const r = await provisionProjectFolders("root", "AEGIS");
    expect(r).toEqual({ projectFolderId: "p", documentsFolderId: "d", reportsFolderId: "r" });
    expect(createFolder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run tests/unit/pma-provision.test.ts --reporter=json --outputFile=/tmp/t4.json`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `lib/pma/provision.ts`**

```ts
import "server-only";

import { listFolder, createFolder } from "@/lib/pma/clients/drive";

const FOLDER_MIME = "application/vnd.google-apps.folder";

// find-or-create a child folder by exact name under parentId.
async function ensureChildFolder(parentId: string, name: string): Promise<string> {
  const existing = (await listFolder(parentId)).find(
    (f) => f.mimeType === FOLDER_MIME && f.name === name,
  );
  return existing ? existing.id : (await createFolder(name, parentId)).id;
}

// Provision the per-project folder structure under the shared Trinno root:
//   <root>/<projectName>/Documents   (analysis reads this, recursively)
//   <root>/<projectName>/Reports     (analysis writes reports here; never scanned)
// Idempotent: re-running resolves the same ids.
export async function provisionProjectFolders(
  rootFolderId: string,
  projectName: string,
): Promise<{ projectFolderId: string; documentsFolderId: string; reportsFolderId: string }> {
  const projectFolderId = await ensureChildFolder(rootFolderId, projectName);
  const documentsFolderId = await ensureChildFolder(projectFolderId, "Documents");
  const reportsFolderId = await ensureChildFolder(projectFolderId, "Reports");
  return { projectFolderId, documentsFolderId, reportsFolderId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run tests/unit/pma-provision.test.ts --reporter=json --outputFile=/tmp/t4.json`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pma/provision.ts tests/unit/pma-provision.test.ts
git commit -m "feat(pma): provisionProjectFolders creates Documents/ + Reports/ siblings"
```

---

### Task 5: Server action to set the workspace's Drive folders in one step

**Files:**
- Create: `actions/pma-folders.ts`
- Test: `tests/unit/pma-folders-action.test.ts`

**Interfaces:**
- Consumes: `provisionProjectFolders` (Task 4); `upsertWorkspaceLinkImpl(token, { workspaceId, url, purpose })` from `actions/links.ts`; `requireUser`/`getSessionToken` from `@/lib/auth`; `getWorkspaceRole` from `@/lib/queries/workspaces`; `extractDriveFileId` from `@/lib/pma/detect`; `process.env.PLAN_IMPORT_DRIVE_ROOT`.
- Produces: `setWorkspaceDriveFolderAction(input: { workspaceId: string; mode: "auto" | "manual"; folderLink?: string }): Promise<{ ok: true } | { ok: false; error: string }>` — owner/admin only. Auto: provision under the Trinno root, set `source` = `<project>/Documents`, `reports` = `<project>/Reports`. Manual: parse the pasted link to a documents folder id; create a `Reports` child inside it; set both links. The folder URL stored is `https://drive.google.com/drive/folders/<id>` (so `getRunInputs`/`extractDriveFileId` parse it back).

- [ ] **Step 1: Write the failing test (auto-mode link writes)**

```ts
// tests/unit/pma-folders-action.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));

const provision = vi.fn();
const upsert = vi.fn().mockResolvedValue(undefined);
const getRole = vi.fn().mockResolvedValue("owner");
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "u1" }), getSessionToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("@/lib/pma/provision", () => ({ provisionProjectFolders: provision }));
vi.mock("@/actions/links", () => ({ upsertWorkspaceLinkImpl: upsert }));
vi.mock("@/lib/queries/workspaces", () => ({ getWorkspaceRole: getRole, getWorkspace: vi.fn().mockResolvedValue({ id: "w1", name: "AEGIS" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { setWorkspaceDriveFolderAction } from "@/actions/pma-folders";

const url = (id: string) => `https://drive.google.com/drive/folders/${id}`;

describe("setWorkspaceDriveFolderAction (auto)", () => {
  beforeEach(() => { provision.mockReset(); upsert.mockReset(); upsert.mockResolvedValue(undefined); process.env.PLAN_IMPORT_DRIVE_ROOT = "root"; });

  it("provisions and sets source + reports links", async () => {
    provision.mockResolvedValue({ projectFolderId: "p", documentsFolderId: "d", reportsFolderId: "r" });
    const res = await setWorkspaceDriveFolderAction({ workspaceId: "w1", mode: "auto" });
    expect(res).toEqual({ ok: true });
    expect(provision).toHaveBeenCalledWith("root", "AEGIS");
    expect(upsert).toHaveBeenCalledWith("tok", { workspaceId: "w1", url: url("d"), purpose: "source" });
    expect(upsert).toHaveBeenCalledWith("tok", { workspaceId: "w1", url: url("r"), purpose: "reports" });
  });

  it("rejects non owner/admin", async () => {
    getRole.mockResolvedValueOnce("member");
    const res = await setWorkspaceDriveFolderAction({ workspaceId: "w1", mode: "auto" });
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run tests/unit/pma-folders-action.test.ts --reporter=json --outputFile=/tmp/t5.json`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `actions/pma-folders.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace, getWorkspaceRole } from "@/lib/queries/workspaces";
import { upsertWorkspaceLinkImpl } from "@/actions/links";
import { provisionProjectFolders } from "@/lib/pma/provision";
import { extractDriveFileId } from "@/lib/pma/detect";
import { createFolder, listFolder } from "@/lib/pma/clients/drive";

const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

export async function setWorkspaceDriveFolderAction(input: {
  workspaceId: string;
  mode: "auto" | "manual";
  folderLink?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const role = await getWorkspaceRole(token, input.workspaceId, user.id);
  if (role !== "owner" && role !== "admin") {
    return { ok: false, error: "Only an owner or admin can configure the analysis folder." };
  }

  let documentsId: string;
  let reportsId: string;

  if (input.mode === "auto") {
    const root = process.env.PLAN_IMPORT_DRIVE_ROOT?.trim();
    if (!root) return { ok: false, error: "Auto folder not configured (set PLAN_IMPORT_DRIVE_ROOT)." };
    const ws = await getWorkspace(token, input.workspaceId);
    if (!ws) return { ok: false, error: "Workspace not found." };
    const folders = await provisionProjectFolders(root, ws.name);
    documentsId = folders.documentsFolderId;
    reportsId = folders.reportsFolderId;
  } else {
    const pasted = extractDriveFileId(input.folderLink ?? "");
    if (!pasted) return { ok: false, error: "Paste a Google Drive folder link." };
    documentsId = pasted;
    // Reports lives as a child of the pasted documents folder (the scan skips it).
    const existing = (await listFolder(pasted)).find(
      (f) => f.mimeType === "application/vnd.google-apps.folder" && f.name === "Reports",
    );
    reportsId = existing ? existing.id : (await createFolder("Reports", pasted)).id;
  }

  await upsertWorkspaceLinkImpl(token, { workspaceId: input.workspaceId, url: folderUrl(documentsId), purpose: "source" });
  await upsertWorkspaceLinkImpl(token, { workspaceId: input.workspaceId, url: folderUrl(reportsId), purpose: "reports" });
  revalidatePath(`/w/${input.workspaceId}/analysis`);
  return { ok: true };
}
```

Note: confirm `upsertWorkspaceLinkImpl` is exported from `actions/links.ts` (it is — see [actions/links.ts:90](../../../actions/links.ts)). If only the `upsertWorkspaceLink` wrapper is exported, call that instead and drop the explicit token.

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run tests/unit/pma-folders-action.test.ts --reporter=json --outputFile=/tmp/t5.json`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
rtk proxy npx tsc --noEmit
git add actions/pma-folders.ts tests/unit/pma-folders-action.test.ts
git commit -m "feat(pma): action to set workspace Documents+Reports folders in one step"
```

---

### Task 6: Mount the `Auto | Manual` folder control on the Analysis page

**Files:**
- Create: `components/pma/analysis-folder-control.tsx` (client)
- Modify: `app/(app)/w/[workspaceId]/analysis/page.tsx` (render it in the header; pass current `source` link + `canConfigure`)
- Modify: `app/(app)/w/[workspaceId]/analysis/page.tsx` data load to fetch the current `source` workspace link

**Interfaces:**
- Consumes: `setWorkspaceDriveFolderAction` (Task 5); the existing segmented control `DriveModeControl` from `components/import-plan/drive-mode-control.tsx` (props: `mode: "auto"|"manual"|"off"`, `onMode`, `folderId`, `onFolderId`, `disabled`); `getAnalysisGate` (already loaded on the page, exposes `isOwnerAdmin`).
- Produces: a client control that, on save, calls the action and refreshes. No render test (JSX).

- [ ] **Step 1: Implement the client control**

```tsx
// components/pma/analysis-folder-control.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DriveModeControl } from "@/components/import-plan/drive-mode-control";
import { setWorkspaceDriveFolderAction } from "@/actions/pma-folders";

export function AnalysisFolderControl({
  workspaceId,
  currentFolderUrl,
}: {
  workspaceId: string;
  currentFolderUrl: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"auto" | "manual" | "off">(currentFolderUrl ? "manual" : "auto");
  const [folderId, setFolderId] = useState(currentFolderUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function save() {
    setError(null);
    startSave(async () => {
      const res = await setWorkspaceDriveFolderAction({
        workspaceId,
        mode: mode === "off" ? "manual" : mode,
        folderLink: folderId,
      });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <DriveModeControl
        mode={mode === "off" ? "manual" : mode}
        onMode={(m) => setMode(m)}
        folderId={folderId}
        onFolderId={setFolderId}
        disabled={saving}
      />
      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save documents folder"}
        </Button>
        {error && <span className="text-sm text-[color:var(--accent-magenta)]">{error}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Load the current source link + render the control on the Analysis page**

In `app/(app)/w/[workspaceId]/analysis/page.tsx`, extend the data load (alongside `listRuns` / `getAnalysisGate`) to read the workspace's `source` link, and render `<AnalysisFolderControl>` in the header when `gate.isOwnerAdmin`. Add the query (mirrors the settings page pattern at [settings/page.tsx:34-43](../../../app/(app)/w/[workspaceId]/settings/page.tsx)):

```tsx
import { dbAsUser } from "@/lib/db/client";
import { links } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { AnalysisFolderControl } from "@/components/pma/analysis-folder-control";

// inside the component, after `ws` is loaded:
const sourceRow = await dbAsUser(token, (tx) =>
  tx.select({ url: links.url })
    .from(links)
    .where(and(eq(links.workspaceId, workspaceId), eq(links.scope, "workspace"), eq(links.purpose, "source")))
    .limit(1),
).then((r) => r[0] ?? null).catch(() => null);

// in the header JSX, near <RunAnalysisPanel>:
{gate.isOwnerAdmin && (
  <AnalysisFolderControl workspaceId={workspaceId} currentFolderUrl={sourceRow?.url ?? null} />
)}
```

- [ ] **Step 3: Typecheck + lint**

Run: `rtk proxy npx tsc --noEmit`
Run: `rtk proxy npx eslint components/pma/analysis-folder-control.tsx "app/(app)/w/[workspaceId]/analysis/page.tsx"`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add components/pma/analysis-folder-control.tsx "app/(app)/w/[workspaceId]/analysis/page.tsx"
git commit -m "feat(pma): configure the documents folder (Auto|Manual) on the Analysis page"
```

- [ ] **Step 5: Live check (manual)**

On a dev workspace, open `/w/<id>/analysis`, pick Auto, Save; confirm the run gate clears (folders configured) and a `<project>/{Documents,Reports}` pair appears in the Trinno Drive root.

---

### Task 7: Remove the folder fields from workspace Settings

**Files:**
- Modify: `components/workspace/workspace-settings-form.tsx` (remove the "Shared folder (link)" and "Reports folder (link)" sections + their props/state)
- Modify: `app/(app)/w/[workspaceId]/settings/page.tsx` (stop loading/passing `sourceLink`/`reportsLink`)

**Interfaces:**
- Produces: the settings form no longer renders folder fields; the Analysis page (Task 6) is the single home.

- [ ] **Step 1: Remove the fields**

In `components/workspace/workspace-settings-form.tsx`: delete the `reportsLink` prop, the `wsLinkOpen`/`reportsLinkOpen` state, and the two `<section>`s ("Shared folder (link)", "Reports folder (link)") plus their `LinkEditDialog`s and the `upsertWorkspaceLink`/`removeWorkspaceLink` imports if unused. In `app/(app)/w/[workspaceId]/settings/page.tsx`: remove the workspace-links query (`sourceLink`/`reportsLink`) and stop passing them to `<WorkspaceSettingsForm>`.

- [ ] **Step 2: Typecheck + lint**

Run: `rtk proxy npx tsc --noEmit`
Run: `rtk proxy npx eslint components/workspace/workspace-settings-form.tsx "app/(app)/w/[workspaceId]/settings/page.tsx"`
Expected: clean (no unused-import errors).

- [ ] **Step 3: Commit**

```bash
git add components/workspace/workspace-settings-form.tsx "app/(app)/w/[workspaceId]/settings/page.tsx"
git commit -m "refactor(pma): move folder config off Settings (now on the Analysis page)"
```

---

### Task 8: Import provisions `Documents/`+`Reports/`, nests Docs, sets both links

**Files:**
- Modify: `lib/plan-import/build.ts` (`buildWorkspaceFromPlan` — after the workspace exists, provision folders + set both workspace links; pass the documents folder to the Drive docs client)
- Modify: `lib/plan-import/drive-docs.ts` (deliverable Docs already nest `<root>/<WP>/Deliverables/`; the `<root>` passed becomes the `Documents` folder, so no layout change beyond the root id)
- Modify: `tests/integration/plan-import-build.test.ts` (assert the workspace gets `source`/`reports` links and Docs land under the Documents folder)

**Interfaces:**
- Consumes: `provisionProjectFolders` (Task 4); the existing Drive-mode resolution in `build.ts` (Auto resolves `PLAN_IMPORT_DRIVE_ROOT`); `upsertWorkspaceLinkImpl`.
- Produces: an imported workspace whose `source` link = `<project>/Documents` and `reports` link = `<project>/Reports`, with deliverable Docs written under `Documents/`.

- [ ] **Step 1: Update the integration test expectations**

In `tests/integration/plan-import-build.test.ts`, where Drive is Auto/Manual (a folder is available), assert that after build the workspace has a `source` link and a `reports` link, and that the deliverable-doc client was rooted at the Documents folder. (Adapt to the existing mock shape in that file — it already stubs the Drive client/links.)

- [ ] **Step 2: Run to verify it fails**

Run: `rtk proxy npx vitest run tests/integration/plan-import-build.test.ts --reporter=json --outputFile=/tmp/t8.json`
Expected: FAIL — build does not yet provision/link the two folders.

- [ ] **Step 3: Wire provisioning into `build.ts`**

In `buildWorkspaceFromPlan`, in the `driveMode === "auto"` / `"manual"` branches (currently around [build.ts:106-120](../../../lib/plan-import/build.ts)), replace the single `resolveProjectFolder` call with `provisionProjectFolders` and set both links. Sketch:

```ts
import { provisionProjectFolders } from "@/lib/pma/provision";
import { upsertWorkspaceLinkImpl } from "@/actions/links";

const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

// ...after `ws` (the workspace) is created and the Drive root is known:
let documentsFolderId: string | null = null;
if (driveMode === "auto") {
  const root = process.env.PLAN_IMPORT_DRIVE_ROOT?.trim();
  if (root) {
    const folders = await step(failures, "drive-auto", () => provisionProjectFolders(root, plan.workspaceName));
    if (folders) {
      documentsFolderId = folders.documentsFolderId;
      await upsertWorkspaceLinkImpl(token, { workspaceId: ws.id, url: folderUrl(folders.documentsFolderId), purpose: "source" });
      await upsertWorkspaceLinkImpl(token, { workspaceId: ws.id, url: folderUrl(folders.reportsFolderId), purpose: "reports" });
    }
  }
} else if (driveMode === "manual" && manualFolderId) {
  const folders = await step(failures, "drive-manual", () => provisionProjectFolders(manualFolderId, plan.workspaceName));
  // (or, for manual, treat manualFolderId as the documents folder + create a Reports child)
  if (folders) { documentsFolderId = folders.documentsFolderId; /* set links as above */ }
}
if (documentsFolderId) drive = makeDriveDocsClient(documentsFolderId);
```

Deliverable Docs then nest under `<documentsFolderId>/<WP>/Deliverables/` automatically (the existing `makeDriveDocsClient` layout), which is under the read root.

- [ ] **Step 4: Run to verify it passes**

Run: `rtk proxy npx vitest run tests/integration/plan-import-build.test.ts --reporter=json --outputFile=/tmp/t8.json`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck + commit**

```bash
rtk proxy npx tsc --noEmit
rtk proxy npx vitest run tests/ --reporter=json --outputFile=/tmp/all.json
git add lib/plan-import/build.ts tests/integration/plan-import-build.test.ts
git commit -m "feat(plan-import): provision Documents/+Reports/ and link both on import"
```

---

## Self-Review

- **Spec coverage:** recursive read (T1-2), Reports sibling output (T3), provisioning (T4), one-action config reusing both links (T5-6), Settings removal (T7), import auto-wiring (T8). Run lock + file-type adapter → Plan 2 (out of scope here, stated up front).
- **Type consistency:** `listFolderTree(folderId, {skipNames})`, `provisionProjectFolders → {projectFolderId, documentsFolderId, reportsFolderId}`, `setWorkspaceDriveFolderAction({workspaceId, mode, folderLink?})`, `createReport(outputFolderId, {name, content})` used consistently across tasks.
- **Verification gaps:** Tasks 6-7 are UI (no JSX render tests per project norms) — verified via tsc/eslint + a live check; all backend tasks are unit/integration tested.
- **Open confirmations during execution:** Task 5 note — use `upsertWorkspaceLinkImpl` vs the `upsertWorkspaceLink` wrapper depending on which is exported; Task 8 manual-mode reports-child handling mirrors Task 5.
