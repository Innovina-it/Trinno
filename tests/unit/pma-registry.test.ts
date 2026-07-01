import { describe, it, expect, vi } from "vitest";

// U8 casing fix — the pure snake_case → camelCase row mappers. supabase-js
// returns raw DB columns (snake_case); these make the returned objects actually
// match the camelCase row types so callers can read row.sourceFileId /
// row.lastVersion. (The service-role client is built lazily, so importing the
// module is side-effect-free with server-only stubbed.)
vi.mock("server-only", () => ({}));

import { mapRegistryRow, mapRunRow } from "@/lib/pma/registry";

describe("mapRegistryRow", () => {
  it("renames every snake_case column to camelCase", () => {
    const raw = {
      id: "id-1",
      workspace_id: "ws-1",
      source_file_id: "drive-abc",
      name: "Spec.gdoc",
      parent_folder_id: "folder-1",
      mime_type: "application/vnd.google-apps.document",
      kind: "editable",
      is_deliverable: true,
      card_link_id: "link-1",
      last_version: "v9",
      last_analyzed_at: "2026-06-08T10:00:00Z",
      state: "active",
      recap_file_id: "recap-1",
      recap_json: { one_line_summary: "did stuff" },
      updated_at: "2026-06-08T10:00:00Z",
    };
    expect(mapRegistryRow(raw)).toEqual({
      id: "id-1",
      workspaceId: "ws-1",
      sourceFileId: "drive-abc",
      name: "Spec.gdoc",
      parentFolderId: "folder-1",
      mimeType: "application/vnd.google-apps.document",
      kind: "editable",
      isDeliverable: true,
      cardLinkId: "link-1",
      lastVersion: "v9",
      lastAnalyzedAt: "2026-06-08T10:00:00Z",
      state: "active",
      recapFileId: "recap-1",
      recapJson: { one_line_summary: "did stuff" },
      updatedAt: "2026-06-08T10:00:00Z",
    });
  });

  it("nulls absent optional columns instead of leaving them undefined", () => {
    const row = mapRegistryRow({
      id: "id-2",
      workspace_id: "ws-1",
      source_file_id: "drive-xyz",
      state: "active",
      updated_at: "2026-06-08T10:00:00Z",
    });
    expect(row.lastVersion).toBeNull();
    expect(row.recapFileId).toBeNull();
    expect(row.recapJson).toBeNull();
    expect(row.isDeliverable).toBe(false);
  });
});

describe("mapRunRow", () => {
  it("renames every snake_case column to camelCase", () => {
    const raw = {
      id: "run-1",
      workspace_id: "ws-1",
      run_at: "2026-06-08T10:00:00Z",
      triggered_by: "user-1",
      status: "success",
      counts: { changed: 2, missed: 1, removed: 0 },
      report_file_id: "doc-1",
      report_web_view_link: "https://docs/doc-1",
      window_start: "2026-06-07T00:00:00Z",
      window_end: "2026-06-08T23:59:59Z",
      fingerprint: { A: "v9" },
    };
    expect(mapRunRow(raw)).toEqual({
      id: "run-1",
      workspaceId: "ws-1",
      runAt: "2026-06-08T10:00:00Z",
      triggeredBy: "user-1",
      status: "success",
      counts: { changed: 2, missed: 1, removed: 0 },
      reportFileId: "doc-1",
      reportWebViewLink: "https://docs/doc-1",
      windowStart: "2026-06-07T00:00:00Z",
      windowEnd: "2026-06-08T23:59:59Z",
      fingerprint: { A: "v9" },
      settings: null,
      startedAt: null,
      heartbeatAt: null,
      cancelRequested: false,
      progress: null,
    });
  });
});
