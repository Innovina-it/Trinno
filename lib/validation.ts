import { z } from "zod";

export const Title = z.string().trim().min(1, "Required").max(120);
export const Email = z.string().trim().email().max(254);
export const Uuid = z.string().uuid();

export const CreateWorkspaceInput = z.object({ name: Title });
export const RenameWorkspaceInput = z.object({ id: Uuid, name: Title });
export const DeleteWorkspaceInput = z.object({ id: Uuid });

export const InviteMemberInput = z.object({
  workspaceId: Uuid,
  email: Email,
  role: z.enum(["admin", "member"]),
});
export const ChangeMemberRoleInput = z.object({
  workspaceId: Uuid,
  userId: Uuid,
  role: z.enum(["owner", "admin", "member"]),
});
export const RemoveMemberInput = z.object({ workspaceId: Uuid, userId: Uuid });

export const CreateBoardInput = z.object({
  workspaceId: Uuid,
  title: Title,
  backgroundKind: z.enum(["color", "image"]).default("color"),
  backgroundValue: z.string().min(1).default("#0079bf"),
});
export const RenameBoardInput = z.object({ id: Uuid, title: Title });
export const SetBoardArchivedInput = z.object({ id: Uuid, archived: z.boolean() });
export const DeleteBoardInput = z.object({ id: Uuid });

export const CreateListInput = z.object({
  boardId: Uuid, title: Title,
});
export const RenameListInput = z.object({ id: Uuid, title: Title });
export const MoveListInput   = z.object({ id: Uuid, position: z.string().min(1).max(64) });
export const ArchiveListInput= z.object({ id: Uuid, archived: z.boolean() });
export const SetWipLimitInput = z.object({
  id: Uuid,
  wipLimit: z.number().int().positive().max(999).nullable(),
});

export const CreateCardInput = z.object({
  listId: Uuid, title: Title,
});
export const CardType = z.enum(["epic", "story", "task", "subtask", "bug"]);
export const UpdateCardInput = z.object({
  id: Uuid,
  title: Title.optional(),
  description: z.string().max(20_000).nullable().optional(),
  dueDate: z.union([z.string(), z.date()]).nullable().optional(),
  dueComplete: z.boolean().optional(),
  type: CardType.optional(),
  parentCardId: Uuid.nullable().optional(),
  storyPoints: z.number().int().min(0).max(999).nullable().optional(),
  estimateMin: z.number().int().nonnegative().nullable().optional(),
  startDate: z.union([z.string(), z.date()]).nullable().optional(),
  targetDate: z.union([z.string(), z.date()]).nullable().optional(),
});
export const MoveCardInput = z.object({
  id: Uuid, listId: Uuid, position: z.string().min(1).max(64),
});
export const ArchiveCardInput = z.object({ id: Uuid, archived: z.boolean() });

export const CreateLabelInput = z.object({
  boardId: Uuid,
  name: z.string().trim().max(60).default(""),
  color: z.string().min(1).max(32),
});
export const RenameLabelInput = z.object({ id: Uuid, name: z.string().trim().max(60), color: z.string().min(1).max(32) });
export const DeleteLabelInput = z.object({ id: Uuid });
export const ToggleCardLabelInput = z.object({ cardId: Uuid, labelId: Uuid });

export const ToggleCardMemberInput = z.object({ cardId: Uuid, userId: Uuid });

export const CreateChecklistInput = z.object({ cardId: Uuid, title: Title });
export const RenameChecklistInput = z.object({ id: Uuid, title: Title });
export const DeleteChecklistInput = z.object({ id: Uuid });
export const AddChecklistItemInput = z.object({ checklistId: Uuid, text: z.string().trim().min(1).max(500) });
export const ToggleChecklistItemInput = z.object({ id: Uuid, completed: z.boolean() });
export const RemoveChecklistItemInput = z.object({ id: Uuid });

export const CreateCommentInput = z.object({ cardId: Uuid, body: z.string().trim().min(1).max(20_000) });
export const EditCommentInput = z.object({ id: Uuid, body: z.string().trim().min(1).max(20_000) });
export const DeleteCommentInput = z.object({ id: Uuid });

export const RegisterAttachmentInput = z.object({
  cardId: Uuid,
  storagePath: z.string().min(1).max(500),
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(120),
  sizeBytes: z.number().int().nonnegative().max(50 * 1024 * 1024),
});
export const DeleteAttachmentInput = z.object({ id: Uuid });

export const LinkKind = z.enum([
  "blocks",
  "is_blocked_by",
  "relates_to",
  "duplicates",
  "is_duplicated_by",
]);
export const CreateCardLinkInput = z.object({
  fromCardId: Uuid,
  toCardId: Uuid,
  kind: LinkKind,
});
export const DeleteCardLinkInput = z.object({ id: Uuid });

export const SprintStateZ = z.enum(["planned", "active", "completed"]);
export const CreateSprintInput = z.object({
  workspaceId: Uuid,
  name: Title,
  goal: z.string().trim().max(500).optional().nullable(),
  startDate: z.union([z.string(), z.date()]).optional().nullable(),
  endDate: z.union([z.string(), z.date()]).optional().nullable(),
});
export const UpdateSprintInput = z.object({
  id: Uuid,
  name: Title.optional(),
  goal: z.string().trim().max(500).nullable().optional(),
  startDate: z.union([z.string(), z.date()]).nullable().optional(),
  endDate: z.union([z.string(), z.date()]).nullable().optional(),
});
export const DeleteSprintInput = z.object({ id: Uuid });
export const StartSprintInput = z.object({ id: Uuid });
export const CompleteSprintInput = z.object({
  id: Uuid,
  carryoverTo: z.union([z.literal("backlog"), Uuid]).default("backlog"),
});
export const AssignCardToSprintInput = z.object({
  cardId: Uuid,
  sprintId: Uuid.nullable(),
});

export const MarkNotificationReadInput = z.object({
  id: Uuid,
  read: z.boolean(),
});
export const MarkAllReadInput = z.object({});
export const WatchCardInput = z.object({ cardId: Uuid });
export const UnwatchCardInput = z.object({ cardId: Uuid });

export const SetEstimateInput = z.object({
  id: Uuid,
  estimateMin: z.number().int().nonnegative().nullable(),
});
export const LogWorkInput = z.object({
  cardId: Uuid,
  minutes: z.number().int().positive().max(100000),
  startedAt: z.union([z.string(), z.date()]).optional().nullable(),
  comment: z.string().trim().max(500).nullable().optional(),
});
export const DeleteWorklogInput = z.object({ id: Uuid });
export const CreateSlaPolicyInput = z.object({
  boardId: Uuid,
  name: Title,
  targetMin: z.number().int().positive(),
  appliesWhen: z.record(z.string(), z.unknown()).default({}),
});
export const UpdateSlaPolicyInput = z.object({
  id: Uuid,
  name: Title.optional(),
  targetMin: z.number().int().positive().optional(),
  appliesWhen: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});
export const DeleteSlaPolicyInput = z.object({ id: Uuid });
export const ScanBoardSlaInput = z.object({ boardId: Uuid });

// Plan #18 — Automation Rules.
const RuleTriggerSchema = z
  .object({
    kind: z.enum([
      "card.create",
      "card.move",
      "card.archive",
      "card.unarchive",
      "card.due",
      "card.label.add",
      "card.label.remove",
      "card.member.assign",
      "card.member.unassign",
      "comment.create",
    ]),
    from_list: Uuid.optional(),
    to_list: Uuid.optional(),
    label_id: Uuid.optional(),
  })
  .passthrough();

const PredicateSchema = z.object({
  field: z.string(),
  op: z.string(),
  value: z.union([z.string(), z.number()]),
});
const ConditionsSchema = z.union([
  z.object({ all: z.array(PredicateSchema) }),
  z.object({ any: z.array(PredicateSchema) }),
  z.object({}).strict(),
]);

const ActionSchema = z
  .object({
    kind: z.enum([
      "set_label",
      "remove_label",
      "assign",
      "unassign",
      "move_to_list",
      "set_type",
      "add_comment",
      "set_due_complete",
      "webhook_post",
    ]),
  })
  .passthrough();

export {
  RuleTriggerSchema,
  ConditionsSchema as RuleConditionsSchema,
  ActionSchema as RuleActionSchema,
};

export const CreateRuleInput = z.object({
  boardId: Uuid,
  name: z.string().trim().min(1).max(120),
  trigger: RuleTriggerSchema,
  conditions: ConditionsSchema.default({}),
  actions: z.array(ActionSchema).min(1).max(20),
});

export const UpdateRuleInput = z.object({
  id: Uuid,
  name: z.string().trim().min(1).max(120).optional(),
  trigger: RuleTriggerSchema.optional(),
  conditions: ConditionsSchema.optional(),
  actions: z.array(ActionSchema).min(1).max(20).optional(),
});

export const DeleteRuleInput = z.object({ id: Uuid });
export const ToggleRuleInput = z.object({ id: Uuid, enabled: z.boolean() });

// Plan #10 — Components + Versions + Releases.
export const CreateComponentInput = z.object({
  boardId: Uuid,
  name: z.string().trim().min(1).max(60),
  leadUserId: Uuid.nullable().optional(),
});
export const UpdateComponentInput = z.object({
  id: Uuid,
  name: z.string().trim().min(1).max(60).optional(),
  leadUserId: Uuid.nullable().optional(),
});
export const DeleteComponentInput = z.object({ id: Uuid });
export const ToggleCardComponentInput = z.object({
  cardId: Uuid,
  componentId: Uuid,
});

export const VersionStateZ = z.enum(["unreleased", "released", "archived"]);
export const CardVersionKindZ = z.enum(["affects", "fixes"]);

export const CreateVersionInput = z.object({
  workspaceId: Uuid,
  name: z.string().trim().min(1).max(60),
  semver: z.string().trim().max(40).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  releaseDate: z.union([z.string(), z.date()]).nullable().optional(),
});
export const UpdateVersionInput = z.object({
  id: Uuid,
  name: z.string().trim().min(1).max(60).optional(),
  semver: z.string().trim().max(40).nullable().optional(),
  state: VersionStateZ.optional(),
  releaseDate: z.union([z.string(), z.date()]).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});
export const DeleteVersionInput = z.object({ id: Uuid });
export const SetCardVersionInput = z.object({
  cardId: Uuid,
  versionId: Uuid,
  kind: CardVersionKindZ,
});
export const ClearCardVersionInput = z.object({
  cardId: Uuid,
  versionId: Uuid,
  kind: CardVersionKindZ,
});
