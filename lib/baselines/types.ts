export type BaselineMeta = { id: string; workspaceId: string; name: string; note: string | null; createdBy: string; createdAt: string; isApproved: boolean };
export type BaselineEntry = {
  cardId: string; title: string;
  startDate: string | null; targetDate: string | null; completedAt: string | null;
  roadmapOrder: number | null; sprintId: string | null; parentCardId: string | null;
  assignees: string[];
};
export type BaselineMilestone = { milestoneId: string; name: string; date: string | null };
export type BaselineDetail = { meta: BaselineMeta; entries: BaselineEntry[]; milestones: BaselineMilestone[] };
export type LiveEntry = BaselineEntry;
export type LiveMilestone = BaselineMilestone;
export type CardVariance = {
  cardId: string; title: string;
  status: "slipped" | "pulled_in" | "unchanged" | "added" | "removed" | "completed_since" | "reordered";
  startDeltaDays: number | null; targetDeltaDays: number | null; durationDeltaDays: number | null;
  assigneesAdded: string[]; assigneesRemoved: string[];
};
export type MilestoneVariance = { milestoneId: string; name: string; status: "moved" | "added" | "removed" | "unchanged"; dateDeltaDays: number | null };
export type VarianceResult = {
  cards: CardVariance[]; milestones: MilestoneVariance[];
  rollup: { slipped: number; pulledIn: number; added: number; removed: number; completedSince: number; worstSlipDays: number };
};
