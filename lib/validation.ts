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

export const CreateCardInput = z.object({
  listId: Uuid, title: Title,
});
export const UpdateCardInput = z.object({
  id: Uuid,
  title: Title.optional(),
  description: z.string().max(20_000).nullable().optional(),
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
