import { describe, it, expect, vi } from "vitest";

// U11 — service-account credential resolution. Inline JSON (prod/Vercel) must
// win over a file path (local dev), and the JSON validation must be strict.
// Pure helpers, so no googleapis/network — server-only is stubbed so importing
// the client module is side-effect-free.
vi.mock("server-only", () => ({}));

import { pickCredentialSource, parseServiceAccount } from "@/lib/pma/clients/drive";

describe("pickCredentialSource", () => {
  it("prefers inline JSON over a file path (prod wins)", () => {
    const src = pickCredentialSource({
      GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"x"}',
      GOOGLE_APPLICATION_CREDENTIALS: "/secrets/sa.json",
    });
    expect(src).toEqual({ kind: "inline", raw: '{"client_email":"x"}' });
  });

  it("falls back to the file path when no inline JSON is set", () => {
    const src = pickCredentialSource({
      GOOGLE_APPLICATION_CREDENTIALS: "/secrets/sa.json",
    });
    expect(src).toEqual({ kind: "file", path: "/secrets/sa.json" });
  });

  it("returns null when neither is configured", () => {
    expect(pickCredentialSource({})).toBeNull();
  });

  it("treats blank/whitespace values as unset", () => {
    expect(
      pickCredentialSource({
        GOOGLE_SERVICE_ACCOUNT_JSON: "   ",
        GOOGLE_APPLICATION_CREDENTIALS: "",
      }),
    ).toBeNull();
  });
});

describe("parseServiceAccount", () => {
  it("returns client_email + private_key from valid JSON", () => {
    const creds = parseServiceAccount(
      JSON.stringify({ client_email: "sa@x.iam", private_key: "KEY", extra: 1 }),
      "GOOGLE_SERVICE_ACCOUNT_JSON",
    );
    expect(creds).toEqual({ client_email: "sa@x.iam", private_key: "KEY" });
  });

  it("throws (naming the source) on invalid JSON", () => {
    expect(() => parseServiceAccount("{not json", "GOOGLE_SERVICE_ACCOUNT_JSON")).toThrow(
      /GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON/,
    );
  });

  it("throws when required fields are missing", () => {
    expect(() => parseServiceAccount(JSON.stringify({ client_email: "x" }), "/secrets/sa.json")).toThrow(
      /missing client_email or private_key/,
    );
  });
});
