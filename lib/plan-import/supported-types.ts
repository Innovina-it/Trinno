// Single source of truth for the file types the plan importer accepts. These are
// exactly the types Gemini ingests directly (PDF, images, plain text), so no
// conversion step is needed. Office docs (docx/xlsx) are deliberately excluded
// for now — they require a conversion the importer doesn't do yet. Client-safe
// (no server-only): the route, the extractor, and the upload UI all import this.

export const SUPPORTED_UPLOAD_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
  "text/csv",
] as const;

export type SupportedMime = (typeof SUPPORTED_UPLOAD_MIME)[number];

export function isSupportedUpload(mime: string): mime is SupportedMime {
  return (SUPPORTED_UPLOAD_MIME as readonly string[]).includes(mime);
}

// For the <input accept> attribute and the file picker.
export const UPLOAD_ACCEPT = SUPPORTED_UPLOAD_MIME.join(",");

// Human-facing label for copy and rejection messages.
export const SUPPORTED_UPLOAD_LABEL = "PDF, image, or text file";
