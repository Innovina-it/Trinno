import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const exportText = vi.fn();
const getFileBytes = vi.fn();
const copyAsGoogleAndExportText = vi.fn();
vi.mock("@/lib/pma/clients/drive", () => ({
  exportText: (...a: unknown[]) => exportText(...a),
  getFileBytes: (...a: unknown[]) => getFileBytes(...a),
  copyAsGoogleAndExportText: (...a: unknown[]) => copyAsGoogleAndExportText(...a),
}));

import { getAnalyzableContent, isAnalyzable } from "@/lib/pma/content";

const DOC = "application/vnd.google-apps.document";
const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("isAnalyzable", () => {
  it("accepts Google-native, PDF/images and Office; rejects the rest", () => {
    expect(isAnalyzable(DOC)).toBe(true);
    expect(isAnalyzable(PDF)).toBe(true);
    expect(isAnalyzable("image/png")).toBe(true);
    expect(isAnalyzable(DOCX)).toBe(true);
    expect(isAnalyzable("application/vnd.google-apps.folder")).toBe(false);
    expect(isAnalyzable("application/zip")).toBe(false);
    expect(isAnalyzable("")).toBe(false);
  });
});

describe("getAnalyzableContent", () => {
  beforeEach(() => {
    exportText.mockReset();
    getFileBytes.mockReset();
    copyAsGoogleAndExportText.mockReset();
  });

  it("Google-native → exports text", async () => {
    exportText.mockResolvedValue("doc text");
    expect(await getAnalyzableContent("f1", DOC)).toEqual({ text: "doc text" });
    expect(exportText).toHaveBeenCalledWith("f1", DOC);
  });

  it("PDF/image → downloads bytes as a file part", async () => {
    getFileBytes.mockResolvedValue({ mimeType: PDF, data: "BASE64" });
    expect(await getAnalyzableContent("f2", PDF)).toEqual({ file: { mimeType: PDF, data: "BASE64" } });
    expect(getFileBytes).toHaveBeenCalledWith("f2");
  });

  it("Office → converts via Drive and exports text", async () => {
    copyAsGoogleAndExportText.mockResolvedValue("converted text");
    expect(await getAnalyzableContent("f3", DOCX)).toEqual({ text: "converted text" });
    expect(copyAsGoogleAndExportText).toHaveBeenCalledWith("f3", DOCX);
  });

  it("unsupported type → throws", async () => {
    await expect(getAnalyzableContent("f4", "application/zip")).rejects.toThrow(/not analyzable/);
  });
});
