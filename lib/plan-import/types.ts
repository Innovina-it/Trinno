import { z } from "zod";

// Client-safe: pure TypeScript types + Zod validation. NO @google/genai import
// here so the review UI (which imports `ProjectPlan`) does not pull the SDK into
// the client bundle. The genai response Schema lives in ./genai-schema.ts.

// "YYYY-MM-DD". Kept permissive (the review UI is the real gate); we only
// guarantee a parseable shape for the builder.
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const DeliverableSchema = z.object({
  title: z.string().min(1),
  taskIndex: z.number().int().nonnegative(),
  due: DateStr,
  month: z.number().int().nonnegative(),
  description: z.string().default(""),
});

export const TaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
});

export const WorkPackageSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  option: z.enum(["RI", "SS", "RI+SS"]),
  start: DateStr,
  end: DateStr,
  description: z.string().default(""),
  lead: z.string().optional(),
  tasks: z.array(TaskSchema),
  deliverables: z.array(DeliverableSchema),
});

export const MilestoneSchema = z.object({
  name: z.string().min(1),
  date: DateStr,
  description: z.string().default(""),
});

export const ProjectPlanSchema = z.object({
  workspaceName: z.string().min(1),
  parentBoardTitle: z.string().min(1),
  workPackages: z.array(WorkPackageSchema),
  milestones: z.array(MilestoneSchema),
});

export type ProjectPlan = z.infer<typeof ProjectPlanSchema>;
export type WorkPackage = z.infer<typeof WorkPackageSchema>;
export type Deliverable = z.infer<typeof DeliverableSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
