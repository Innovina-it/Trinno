"use client";
import { useEffect } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { useBoardStore } from "@/stores/board-store";
import type {
  ListRow,
  CardRow,
  LabelRow,
  CardLabelRow,
  CardMemberRow,
  ChecklistRow,
  ChecklistItemRow,
  CommentRow,
  AttachmentRow,
  CardLinkRow,
  ComponentRow,
  CardComponentRow,
  CardVersionRow,
} from "@/lib/queries/board-snapshot";

function rowToList(r: Record<string, unknown>): ListRow {
  return {
    id: r.id as string,
    boardId: r.board_id as string,
    title: r.title as string,
    position: r.position as string,
    archived: r.archived as boolean,
    createdAt: new Date(r.created_at as string),
    wipLimit: (r.wip_limit ?? null) as number | null,
  };
}

function rowToCard(r: Record<string, unknown>): CardRow {
  return {
    id: r.id as string,
    listId: r.list_id as string,
    boardId: r.board_id as string,
    title: r.title as string,
    description: (r.description ?? null) as string | null,
    position: r.position as string,
    archived: r.archived as boolean,
    createdAt: new Date(r.created_at as string),
    dueDate: r.due_date ? new Date(r.due_date as string) : null,
    dueComplete: (r.due_complete ?? false) as boolean,
    coverColor: (r.cover_color ?? null) as string | null,
    type: (r.type ?? "task") as string,
    parentCardId: (r.parent_card_id ?? null) as string | null,
    sprintId: (r.sprint_id ?? null) as string | null,
    storyPoints: (r.story_points ?? null) as number | null,
    estimateMin: (r.estimate_min ?? null) as number | null,
    spentMin: (r.spent_min ?? 0) as number,
  };
}

function rowToLabel(r: Record<string, unknown>): LabelRow {
  return {
    id: r.id as string,
    boardId: r.board_id as string,
    name: (r.name ?? "") as string,
    color: r.color as string,
  };
}

function rowToCardLabel(r: Record<string, unknown>): CardLabelRow {
  return {
    cardId: r.card_id as string,
    labelId: r.label_id as string,
  };
}

function rowToCardMember(r: Record<string, unknown>): CardMemberRow {
  return {
    cardId: r.card_id as string,
    userId: r.user_id as string,
  };
}

function rowToChecklist(r: Record<string, unknown>): ChecklistRow {
  return {
    id: r.id as string,
    cardId: r.card_id as string,
    boardId: r.board_id as string,
    title: r.title as string,
    position: r.position as string,
    createdAt: new Date(r.created_at as string),
  };
}

function rowToChecklistItem(r: Record<string, unknown>): ChecklistItemRow {
  return {
    id: r.id as string,
    checklistId: r.checklist_id as string,
    boardId: r.board_id as string,
    text: r.text as string,
    completed: (r.completed ?? false) as boolean,
    position: r.position as string,
    createdAt: new Date(r.created_at as string),
  };
}

function rowToComment(r: Record<string, unknown>): CommentRow {
  return {
    id: r.id as string,
    cardId: r.card_id as string,
    boardId: r.board_id as string,
    authorId: r.author_id as string,
    body: r.body as string,
    createdAt: new Date(r.created_at as string),
    editedAt: r.edited_at ? new Date(r.edited_at as string) : null,
  };
}

function rowToAttachment(r: Record<string, unknown>): AttachmentRow {
  return {
    id: r.id as string,
    cardId: r.card_id as string,
    boardId: r.board_id as string,
    storagePath: r.storage_path as string,
    filename: r.filename as string,
    mime: r.mime as string,
    sizeBytes: r.size_bytes as number,
    uploadedBy: r.uploaded_by as string,
    createdAt: new Date(r.created_at as string),
  };
}

function rowToCardLink(r: Record<string, unknown>): CardLinkRow {
  return {
    id: r.id as string,
    fromCardId: r.from_card_id as string,
    toCardId: r.to_card_id as string,
    kind: r.kind as CardLinkRow["kind"],
    boardId: r.board_id as string,
    createdBy: (r.created_by ?? null) as string | null,
    createdAt: new Date(r.created_at as string),
  };
}

function rowToComponent(r: Record<string, unknown>): ComponentRow {
  return {
    id: r.id as string,
    boardId: r.board_id as string,
    name: r.name as string,
    leadUserId: (r.lead_user_id ?? null) as string | null,
    createdAt: new Date(r.created_at as string),
  };
}

function rowToCardComponent(r: Record<string, unknown>): CardComponentRow {
  return {
    cardId: r.card_id as string,
    componentId: r.component_id as string,
    boardId: r.board_id as string,
  };
}

function rowToCardVersion(r: Record<string, unknown>): CardVersionRow {
  return {
    cardId: r.card_id as string,
    versionId: r.version_id as string,
    kind: r.kind as CardVersionRow["kind"],
    workspaceId: r.workspace_id as string,
  };
}

export function useBoardRealtime(boardId: string, workspaceId?: string) {
  const addList = useBoardStore((s) => s.addList);
  const addCard = useBoardStore((s) => s.addCard);
  const updateCard = useBoardStore((s) => s.updateCard);
  const moveList = useBoardStore((s) => s.moveList);
  const moveCard = useBoardStore((s) => s.moveCard);
  const removeList = useBoardStore((s) => s.removeList);
  const removeCard = useBoardStore((s) => s.removeCard);
  const renameList = useBoardStore((s) => s.renameList);

  const addLabel = useBoardStore((s) => s.addLabel);
  const updateLabel = useBoardStore((s) => s.updateLabel);
  const removeLabel = useBoardStore((s) => s.removeLabel);

  const addCardLabel = useBoardStore((s) => s.addCardLabel);
  const removeCardLabel = useBoardStore((s) => s.removeCardLabel);

  const addCardMember = useBoardStore((s) => s.addCardMember);
  const removeCardMember = useBoardStore((s) => s.removeCardMember);

  const addChecklist = useBoardStore((s) => s.addChecklist);
  const updateChecklist = useBoardStore((s) => s.updateChecklist);
  const removeChecklist = useBoardStore((s) => s.removeChecklist);

  const addChecklistItem = useBoardStore((s) => s.addChecklistItem);
  const updateChecklistItem = useBoardStore((s) => s.updateChecklistItem);
  const removeChecklistItem = useBoardStore((s) => s.removeChecklistItem);

  const addComment = useBoardStore((s) => s.addComment);
  const updateComment = useBoardStore((s) => s.updateComment);
  const removeComment = useBoardStore((s) => s.removeComment);

  const addAttachment = useBoardStore((s) => s.addAttachment);
  const removeAttachment = useBoardStore((s) => s.removeAttachment);

  const addCardLink = useBoardStore((s) => s.addCardLink);
  const removeCardLink = useBoardStore((s) => s.removeCardLink);

  const addComponent = useBoardStore((s) => s.addComponent);
  const updateComponent = useBoardStore((s) => s.updateComponent);
  const removeComponent = useBoardStore((s) => s.removeComponent);

  const addCardComponent = useBoardStore((s) => s.addCardComponent);
  const removeCardComponent = useBoardStore((s) => s.removeCardComponent);

  const addCardVersion = useBoardStore((s) => s.addCardVersion);
  const removeCardVersion = useBoardStore((s) => s.removeCardVersion);

  useEffect(() => {
    const supa = createSupabaseBrowser();
    let cancelled = false;
    let channel: ReturnType<typeof supa.channel> | null = null;

    (async () => {
      // Make sure the realtime socket carries the user's JWT before joining.
      // postgres_changes evaluates the table's RLS policy as the JWT subject,
      // so without this the join uses anon and the channel receives nothing.
      const { data } = await supa.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supa.realtime.setAuth(token);
      if (cancelled) return;

      const ch = supa.channel(`board:${boardId}`);
      channel = ch;
      ch
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "lists",
            filter: `board_id=eq.${boardId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              addList(rowToList(payload.new));
            } else if (payload.eventType === "UPDATE" && payload.new) {
              const r = payload.new;
              if (r.archived) {
                removeList(r.id);
              } else {
                if (r.position) moveList(r.id, r.position);
                if (typeof r.title === "string") renameList(r.id, r.title);
              }
            } else if (payload.eventType === "DELETE" && payload.old) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              removeList((payload.old as any).id);
            }
          },
        )
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "cards",
            filter: `board_id=eq.${boardId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              addCard(rowToCard(payload.new));
            } else if (payload.eventType === "UPDATE" && payload.new) {
              const r = payload.new;
              if (r.archived) {
                removeCard(r.id);
              } else {
                const next = rowToCard(r);
                // Patch in place so non-position fields (title, description,
                // due_date, due_complete, cover_color) propagate too.
                updateCard(next.id, next);
                if (r.list_id && r.position) {
                  moveCard(r.id, r.list_id, r.position);
                }
              }
            } else if (payload.eventType === "DELETE" && payload.old) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              removeCard((payload.old as any).id);
            }
          },
        )
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "labels",
            filter: `board_id=eq.${boardId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              addLabel(rowToLabel(payload.new));
            } else if (payload.eventType === "UPDATE" && payload.new) {
              const l = rowToLabel(payload.new);
              updateLabel(l.id, l);
            } else if (payload.eventType === "DELETE" && payload.old) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              removeLabel((payload.old as any).id);
            }
          },
        )
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "card_labels",
            filter: `board_id=eq.${boardId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              addCardLabel(rowToCardLabel(payload.new));
            } else if (payload.eventType === "DELETE" && payload.old) {
              const o = payload.old as Record<string, unknown>;
              removeCardLabel(o.card_id as string, o.label_id as string);
            }
          },
        )
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "card_members",
            filter: `board_id=eq.${boardId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              addCardMember(rowToCardMember(payload.new));
            } else if (payload.eventType === "DELETE" && payload.old) {
              const o = payload.old as Record<string, unknown>;
              removeCardMember(o.card_id as string, o.user_id as string);
            }
          },
        )
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "checklists",
            filter: `board_id=eq.${boardId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              addChecklist(rowToChecklist(payload.new));
            } else if (payload.eventType === "UPDATE" && payload.new) {
              const c = rowToChecklist(payload.new);
              updateChecklist(c.id, c);
            } else if (payload.eventType === "DELETE" && payload.old) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              removeChecklist((payload.old as any).id);
            }
          },
        )
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "checklist_items",
            filter: `board_id=eq.${boardId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              addChecklistItem(rowToChecklistItem(payload.new));
            } else if (payload.eventType === "UPDATE" && payload.new) {
              const i = rowToChecklistItem(payload.new);
              updateChecklistItem(i.id, i);
            } else if (payload.eventType === "DELETE" && payload.old) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              removeChecklistItem((payload.old as any).id);
            }
          },
        )
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "comments",
            filter: `board_id=eq.${boardId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              addComment(rowToComment(payload.new));
            } else if (payload.eventType === "UPDATE" && payload.new) {
              const c = rowToComment(payload.new);
              updateComment(c.id, c);
            } else if (payload.eventType === "DELETE" && payload.old) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              removeComment((payload.old as any).id);
            }
          },
        )
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "attachments",
            filter: `board_id=eq.${boardId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              addAttachment(rowToAttachment(payload.new));
            } else if (payload.eventType === "DELETE" && payload.old) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              removeAttachment((payload.old as any).id);
            }
          },
        )
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "card_links",
            filter: `board_id=eq.${boardId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              addCardLink(rowToCardLink(payload.new));
            } else if (payload.eventType === "DELETE" && payload.old) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              removeCardLink((payload.old as any).id);
            }
          },
        )
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "components",
            filter: `board_id=eq.${boardId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              addComponent(rowToComponent(payload.new));
            } else if (payload.eventType === "UPDATE" && payload.new) {
              const c = rowToComponent(payload.new);
              updateComponent(c.id, c);
            } else if (payload.eventType === "DELETE" && payload.old) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              removeComponent((payload.old as any).id);
            }
          },
        )
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "card_components",
            filter: `board_id=eq.${boardId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              addCardComponent(rowToCardComponent(payload.new));
            } else if (payload.eventType === "DELETE" && payload.old) {
              const o = payload.old as Record<string, unknown>;
              removeCardComponent(
                o.card_id as string,
                o.component_id as string,
              );
            }
          },
        );

      if (workspaceId) {
        ch.on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "card_versions",
            filter: `workspace_id=eq.${workspaceId}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              addCardVersion(rowToCardVersion(payload.new));
            } else if (payload.eventType === "DELETE" && payload.old) {
              const o = payload.old as Record<string, unknown>;
              removeCardVersion(
                o.card_id as string,
                o.version_id as string,
                o.kind as CardVersionRow["kind"],
              );
            }
          },
        );
      }

      ch.subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supa.removeChannel(channel);
    };
  }, [
    boardId,
    workspaceId,
    addList,
    addCard,
    updateCard,
    moveList,
    moveCard,
    removeList,
    removeCard,
    renameList,
    addLabel,
    updateLabel,
    removeLabel,
    addCardLabel,
    removeCardLabel,
    addCardMember,
    removeCardMember,
    addChecklist,
    updateChecklist,
    removeChecklist,
    addChecklistItem,
    updateChecklistItem,
    removeChecklistItem,
    addComment,
    updateComment,
    removeComment,
    addAttachment,
    removeAttachment,
    addCardLink,
    removeCardLink,
    addComponent,
    updateComponent,
    removeComponent,
    addCardComponent,
    removeCardComponent,
    addCardVersion,
    removeCardVersion,
  ]);
}
