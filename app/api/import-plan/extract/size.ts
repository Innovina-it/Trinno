export const MAX_PDF_BYTES = 15 * 1024 * 1024; // inline Gemini cap (v1)

// Pure size guard for the uploaded PDF. Returns an error message string when the
// file is over the inline cap, or null when it is acceptable.
export function checkPdfSize(bytes: number): string | null {
  if (bytes > MAX_PDF_BYTES) {
    return `PDF is too large (${(bytes / 1024 / 1024).toFixed(1)} MB; max ${MAX_PDF_BYTES / 1024 / 1024} MB). Split it or use a smaller export.`;
  }
  return null;
}
