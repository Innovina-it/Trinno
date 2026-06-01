import { describe, it, expect } from "vitest";
import { assertWorkspaceWriter } from "@/lib/permissions/workspace-writer";
import { StructuredError } from "@/lib/errors";

describe("assertWorkspaceWriter", () => {
  it("allows owner and admin", () => {
    expect(() => assertWorkspaceWriter("owner")).not.toThrow();
    expect(() => assertWorkspaceWriter("admin")).not.toThrow();
  });
  it("rejects member, guest and null", () => {
    for (const r of ["member", "guest", null] as const) {
      expect(() => assertWorkspaceWriter(r)).toThrow(StructuredError);
    }
  });
});
