import "server-only";

import { GoogleGenAI } from "@google/genai";
import type { Schema } from "@google/genai";

// Server-only Google Gemini client for the PM Assistant (PMA).
//
// Scope (U1b): a typed wrapper over @google/genai that returns STRUCTURED JSON.
// Two model tiers are used downstream — Flash for the per-file recaps (U6) and
// Pro for the workspace synthesis (U7) — but this unit only exposes the generic
// `generateStructured` seam; prompt/schema construction belongs to U6/U7.
//
// SECRET IS SERVER-ONLY. The `import "server-only"` guard makes this module
// throw if pulled into a client bundle. GEMINI_API_KEY is read LAZILY the first
// time a client is built — importing this module never touches env, so
// type-check/build/tests pass with no key configured.
//
// NOTE: uses `@google/genai` (the current SDK). The legacy
// `@google/generative-ai` named in the original design is deprecated.

export type GeminiModel = "gemini-2.5-flash" | "gemini-2.5-pro";

export type StructuredInput = {
  model: GeminiModel;
  // Optional steering instruction (DESIGN §5 — recap vs synthesis personas).
  systemInstruction?: string;
  prompt: string;
  // JSON-Schema-style response contract (genai `Schema`). The model is asked to
  // emit application/json conforming to this.
  responseSchema: Schema;
  temperature?: number;
};

// Cached authenticated client. Built lazily on first use so importing this
// module is side-effect-free (no env read).
let cached: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (cached) return cached;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set — add the Google AI Studio key (AIza…) to .env.local (local) / vercel env (prod).",
    );
  }
  cached = new GoogleGenAI({ apiKey });
  return cached;
}

// Generate a structured JSON response and parse it to `T`. The caller owns the
// schema/type pairing; this enforces application/json + JSON parsing and throws
// on an empty or non-JSON response (→ the caller marks the file state=error,
// surfaced as a "missed update").
export async function generateStructured<T>(input: StructuredInput): Promise<T> {
  const ai = getClient();
  const res = await ai.models.generateContent({
    model: input.model,
    contents: input.prompt,
    config: {
      ...(input.systemInstruction
        ? { systemInstruction: input.systemInstruction }
        : {}),
      responseMimeType: "application/json",
      responseSchema: input.responseSchema,
      ...(input.temperature !== undefined
        ? { temperature: input.temperature }
        : {}),
    },
  });
  const text = res.text;
  if (!text || !text.trim()) {
    throw new Error("Gemini returned an empty response.");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Gemini response was not valid JSON.");
  }
}

// Reset the cached client. Test-only escape hatch; not used in the app path.
export function __resetGeminiClientForTests(): void {
  cached = null;
}
