// Plan #18 — Automation Rules: TypeScript types for the engine.
// Trigger / Condition / Action JSON shapes (kept loose enough for jsonb storage).

export type RuleEvent =
  | { kind: "card.create"; cardId: string; listId: string; boardId: string }
  | {
      kind: "card.move";
      cardId: string;
      fromListId: string;
      toListId: string;
      boardId: string;
    }
  | { kind: "card.archive"; cardId: string; boardId: string }
  | { kind: "card.unarchive"; cardId: string; boardId: string }
  | {
      kind: "card.due";
      cardId: string;
      dueDate: string | null;
      dueComplete: boolean;
      boardId: string;
    }
  | { kind: "card.label.add"; cardId: string; labelId: string; boardId: string }
  | {
      kind: "card.label.remove";
      cardId: string;
      labelId: string;
      boardId: string;
    }
  | {
      kind: "card.member.assign";
      cardId: string;
      userId: string;
      boardId: string;
    }
  | {
      kind: "card.member.unassign";
      cardId: string;
      userId: string;
      boardId: string;
    }
  | {
      kind: "comment.create";
      cardId: string;
      commentId: string;
      boardId: string;
    };

export type RuleTrigger = {
  kind: RuleEvent["kind"];
  from_list?: string;
  to_list?: string;
  label_id?: string;
};

export type RuleConditionPredicate =
  | { field: "type"; op: "eq" | "neq"; value: string }
  | { field: "title"; op: "contains" | "matches"; value: string }
  | { field: "list_id"; op: "eq" | "neq"; value: string }
  | { field: "label_count"; op: "eq" | "gte" | "lte"; value: number }
  | { field: "story_points"; op: "eq" | "gte" | "lte"; value: number }
  | { field: "has_label"; op: "eq"; value: string };

export type RuleConditions =
  | { all: RuleConditionPredicate[] }
  | { any: RuleConditionPredicate[] }
  | Record<string, never>; // empty = always true

export type RuleAction =
  | { kind: "set_label"; label_id: string }
  | { kind: "remove_label"; label_id: string }
  | { kind: "assign"; user_id: string }
  | { kind: "unassign"; user_id: string }
  | { kind: "move_to_list"; list_id: string }
  | { kind: "set_type"; value: "epic" | "story" | "task" | "subtask" | "bug" }
  | { kind: "add_comment"; body: string }
  | { kind: "set_due_complete"; value: boolean }
  | { kind: "webhook_post"; url: string; secret?: string };
