export type NotificationKind =
  | "comment.mention"
  | "comment.create"
  | "card.assigned"
  | "card.unassigned"
  | "card.owner_assigned"
  | "card.owner_unassigned"
  | "card.due"
  | "card.dates"
  | "card.archived"
  | "card.unarchived"
  | "card.moved"
  | "card.label.added"
  | "card.linked"
  | "card.sprint_changed"
  | "card.completed"
  | "board.member.added";

export const EMAIL_KIND_LABELS: Record<
  NotificationKind,
  { subject: string; preview: string }
> = {
  "comment.mention": { subject: "mention", preview: "mentions" },
  "comment.create": { subject: "new comment", preview: "new comments" },
  "card.assigned": { subject: "assignment", preview: "assignments" },
  "card.unassigned": { subject: "unassignment", preview: "unassignments" },
  "card.owner_assigned": {
    subject: "owner assignment",
    preview: "owner assignments",
  },
  "card.owner_unassigned": {
    subject: "owner removal",
    preview: "owner removals",
  },
  "card.due": { subject: "due date", preview: "due dates" },
  "card.dates": { subject: "reschedule", preview: "reschedules" },
  "card.archived": { subject: "archive", preview: "archives" },
  "card.unarchived": { subject: "restore", preview: "restores" },
  "card.moved": { subject: "card move", preview: "card moves" },
  "card.label.added": { subject: "label update", preview: "label updates" },
  "card.linked": { subject: "card link", preview: "card links" },
  "card.sprint_changed": {
    subject: "sprint move",
    preview: "sprint moves",
  },
  "card.completed": { subject: "completion", preview: "completions" },
  "board.member.added": {
    subject: "board membership",
    preview: "board memberships",
  },
};
