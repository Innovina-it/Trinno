import { describe, it, expect } from "vitest";
import {
  SUPPORTED_UPLOAD_MIME,
  isSupportedUpload,
  UPLOAD_ACCEPT,
} from "@/lib/plan-import/supported-types";

describe("isSupportedUpload", () => {
  it("accepts the Gemini-native plan inputs", () => {
    expect(isSupportedUpload("application/pdf")).toBe(true);
    expect(isSupportedUpload("image/png")).toBe(true);
    expect(isSupportedUpload("image/jpeg")).toBe(true);
    expect(isSupportedUpload("text/plain")).toBe(true);
  });
  it("rejects Office docs and unknown types (they need conversion we don't do yet)", () => {
    expect(
      isSupportedUpload(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(false); // .docx
    expect(
      isSupportedUpload(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(false); // .xlsx
    expect(isSupportedUpload("")).toBe(false);
    expect(isSupportedUpload("application/octet-stream")).toBe(false);
  });
  it("UPLOAD_ACCEPT lists every supported type for the file picker", () => {
    for (const m of SUPPORTED_UPLOAD_MIME) expect(UPLOAD_ACCEPT).toContain(m);
  });
});
