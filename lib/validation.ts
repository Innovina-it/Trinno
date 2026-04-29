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
