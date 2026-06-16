import { describe, it, expect } from "vitest";
import { MAX_PDF_BYTES, checkPdfSize } from "@/app/api/import-plan/extract/size";

describe("checkPdfSize", () => {
  it("accepts a small PDF", () => {
    expect(checkPdfSize(1_000)).toBeNull();
  });
  it("accepts exactly the cap", () => {
    expect(checkPdfSize(MAX_PDF_BYTES)).toBeNull();
  });
  it("rejects over the cap", () => {
    expect(checkPdfSize(MAX_PDF_BYTES + 1)).toMatch(/too large/i);
  });
});
