import { describe, it, expect } from "vitest";
import { Type } from "@google/genai";
import { ProjectPlanSchema } from "@/lib/plan-import/types";
import { PROJECT_PLAN_GENAI_SCHEMA } from "@/lib/plan-import/genai-schema";

const valid = {
  workspaceName: "AEGIS — Project Plan",
  parentBoardTitle: "AEGIS · Project Plan",
  workPackages: [
    {
      code: "WP1",
      title: "WP1 — Requirements",
      option: "RI",
      start: "2026-01-01",
      end: "2026-06-30",
      description: "…",
      lead: "INNOVINA",
      tasks: [{ title: "T1.1 — SOTA", description: "…" }],
      deliverables: [
        { title: "D1.1 — Requirements", taskIndex: 0, due: "2026-06-30", month: 6, description: "…" },
      ],
    },
  ],
  milestones: [{ name: "M6 — Baseline", date: "2026-06-30", description: "…" }],
};

describe("ProjectPlanSchema", () => {
  it("accepts a valid plan", () => {
    expect(ProjectPlanSchema.parse(valid)).toMatchObject({ workspaceName: "AEGIS — Project Plan" });
  });

  it("rejects an invalid option enum", () => {
    const bad = { ...valid, workPackages: [{ ...valid.workPackages[0], option: "XX" }] };
    expect(() => ProjectPlanSchema.parse(bad)).toThrow();
  });

  it("rejects a deliverable taskIndex that is not an integer", () => {
    const wp = {
      ...valid.workPackages[0],
      deliverables: [{ ...valid.workPackages[0].deliverables[0], taskIndex: 1.5 }],
    };
    expect(() => ProjectPlanSchema.parse({ ...valid, workPackages: [wp] })).toThrow();
  });

  it("rejects a malformed date", () => {
    const bad = { ...valid, milestones: [{ name: "M", date: "June 2026", description: "" }] };
    expect(() => ProjectPlanSchema.parse(bad)).toThrow();
  });
});

describe("PROJECT_PLAN_GENAI_SCHEMA", () => {
  it("is an object schema with the four top-level properties", () => {
    expect(PROJECT_PLAN_GENAI_SCHEMA.type).toBe(Type.OBJECT);
    expect(Object.keys(PROJECT_PLAN_GENAI_SCHEMA.properties ?? {})).toEqual(
      expect.arrayContaining(["workspaceName", "parentBoardTitle", "workPackages", "milestones"]),
    );
  });
});
