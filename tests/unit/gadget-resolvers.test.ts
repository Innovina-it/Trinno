import { describe, it, expect } from "vitest";
import { resolveMarkdownNote } from "@/lib/dashboards/resolvers";

describe("gadget resolvers (pure)", () => {
  it("resolveMarkdownNote returns body unchanged", async () => {
    const r = await resolveMarkdownNote("ignored", { body: "hello **world**" });
    expect(r.body).toBe("hello **world**");
  });

  it("resolveMarkdownNote returns empty string when body is missing", async () => {
    const r = await resolveMarkdownNote("ignored", {});
    expect(r.body).toBe("");
  });
});
