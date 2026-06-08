import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// U1b Gemini client — typed structured-output wrapper over @google/genai.
// The SDK is mocked so this verifies request wiring + response handling with
// NO real API call. `server-only` is stubbed (bundler-time guard, not runtime).
vi.mock("server-only", () => ({}));

// Hoisted so the vi.mock factory (which is hoisted above module code) can close
// over real, constructable mocks. `GoogleGenAI` must be a vi.fn so `new` works.
const { generateContent, GoogleGenAI, keyHolder } = vi.hoisted(() => {
  const generateContent = vi.fn();
  const keyHolder: { apiKey?: string } = {};
  const GoogleGenAI = vi.fn().mockImplementation(function (opts: { apiKey?: string }) {
    keyHolder.apiKey = opts?.apiKey;
    return { models: { generateContent } };
  });
  return { generateContent, GoogleGenAI, keyHolder };
});

vi.mock("@google/genai", () => ({ GoogleGenAI }));

import {
  generateStructured,
  __resetGeminiClientForTests,
} from "@/lib/pma/clients/gemini";
// Type-only import resolves against the real SDK .d.ts (unaffected by vi.mock);
// the runtime value is an opaque pass-through the mock never inspects.
import type { Schema } from "@google/genai";

const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

beforeEach(() => {
  generateContent.mockReset();
  GoogleGenAI.mockClear();
  keyHolder.apiKey = undefined;
  process.env.GEMINI_API_KEY = "test-key-123";
  __resetGeminiClientForTests();
});
afterEach(() => {
  process.env.GEMINI_API_KEY = ORIGINAL_KEY;
});

const SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
} as unknown as Schema;

describe("generateStructured", () => {
  it("wires model, prompt, JSON mime, schema, system instruction and temperature", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ ok: true }) });

    const out = await generateStructured<{ ok: boolean }>({
      model: "gemini-2.5-flash",
      systemInstruction: "Be terse.",
      prompt: "Summarize.",
      responseSchema: SCHEMA,
      temperature: 0.2,
    });

    expect(out).toEqual({ ok: true });
    expect(generateContent).toHaveBeenCalledTimes(1);
    const arg = generateContent.mock.calls[0][0];
    expect(arg.model).toBe("gemini-2.5-flash");
    expect(arg.contents).toBe("Summarize.");
    expect(arg.config.responseMimeType).toBe("application/json");
    expect(arg.config.responseSchema).toBe(SCHEMA);
    expect(arg.config.systemInstruction).toBe("Be terse.");
    expect(arg.config.temperature).toBe(0.2);
  });

  it("omits systemInstruction and temperature when not supplied", async () => {
    generateContent.mockResolvedValue({ text: "{}" });
    await generateStructured({
      model: "gemini-2.5-pro",
      prompt: "x",
      responseSchema: SCHEMA,
    });
    const cfg = generateContent.mock.calls[0][0].config;
    expect(cfg.responseMimeType).toBe("application/json");
    expect("systemInstruction" in cfg).toBe(false);
    expect("temperature" in cfg).toBe(false);
  });

  it("parses and returns the typed JSON payload", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({ executive_summary: "hi", count: 3 }),
    });
    const out = await generateStructured<{ executive_summary: string; count: number }>({
      model: "gemini-2.5-pro",
      prompt: "p",
      responseSchema: SCHEMA,
    });
    expect(out.executive_summary).toBe("hi");
    expect(out.count).toBe(3);
  });

  it("throws on an empty response", async () => {
    generateContent.mockResolvedValue({ text: "" });
    await expect(
      generateStructured({ model: "gemini-2.5-flash", prompt: "p", responseSchema: SCHEMA }),
    ).rejects.toThrow(/empty/i);
  });

  it("throws when the response is not valid JSON", async () => {
    generateContent.mockResolvedValue({ text: "not json {{" });
    await expect(
      generateStructured({ model: "gemini-2.5-flash", prompt: "p", responseSchema: SCHEMA }),
    ).rejects.toThrow(/json/i);
  });

  it("passes the API key from the environment and caches the client", async () => {
    generateContent.mockResolvedValue({ text: "{}" });
    await generateStructured({ model: "gemini-2.5-flash", prompt: "a", responseSchema: SCHEMA });
    await generateStructured({ model: "gemini-2.5-flash", prompt: "b", responseSchema: SCHEMA });
    expect(keyHolder.apiKey).toBe("test-key-123");
    expect(GoogleGenAI).toHaveBeenCalledTimes(1); // cached across calls
  });

  it("throws a clear error when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    __resetGeminiClientForTests();
    await expect(
      generateStructured({ model: "gemini-2.5-flash", prompt: "p", responseSchema: SCHEMA }),
    ).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
