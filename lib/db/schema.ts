import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
  pgEnum,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const workspaceRole = pgEnum("workspace_role", [
  "owner",
  "admin",
  "member",
]);
export const boardRole = pgEnum("board_role", ["admin", "member", "observer"]);
export const boardVisibility = pgEnum("board_visibility", [
  "private",
  "workspace",
]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: workspaceRole("role").notNull().default("member"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.userId] }) }),
);

export const boards = pgTable(
  "boards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    title: text("title").notNull(),
    backgroundKind: text("background_kind").notNull().default("color"),
    backgroundValue: text("background_value").notNull().default("#0079bf"),
    visibility: boardVisibility("visibility").notNull().default("workspace"),
    createdBy: uuid("created_by").notNull(),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    backgroundKindCheck: check(
      "boards_background_kind_check",
      sql`${t.backgroundKind} in ('color', 'image')`,
    ),
  }),
);

export const boardMembers = pgTable(
  "board_members",
  {
    boardId: uuid("board_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: boardRole("role").notNull().default("member"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.boardId, t.userId] }) }),
);

export const lists = pgTable("lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull(),
  title: text("title").notNull(),
  position: text("position").notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  wipLimit: integer("wip_limit"),
});

export const cards = pgTable("cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  listId: uuid("list_id").notNull(),
  boardId: uuid("board_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  position: text("position").notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  dueComplete: boolean("due_complete").notNull().default(false),
  coverColor: text("cover_color"),
  type: text("type").notNull().default("task"),
  parentCardId: uuid("parent_card_id"),
  sprintId: uuid("sprint_id"),
  storyPoints: integer("story_points"),
  estimateMin: integer("estimate_min"),
  spentMin: integer("spent_min").notNull().default(0),
});

export const labels = pgTable("labels", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull(),
  name: text("name").notNull().default(""),
  color: text("color").notNull(),
});

export const cardLabels = pgTable(
  "card_labels",
  {
    cardId: uuid("card_id").notNull(),
    labelId: uuid("label_id").notNull(),
    boardId: uuid("board_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cardId, t.labelId] }) }),
);

export const cardMembers = pgTable(
  "card_members",
  {
    cardId: uuid("card_id").notNull(),
    userId: uuid("user_id").notNull(),
    boardId: uuid("board_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cardId, t.userId] }) }),
);

export const checklists = pgTable("checklists", {
  id: uuid("id").primaryKey().defaultRandom(),
  cardId: uuid("card_id").notNull(),
  boardId: uuid("board_id").notNull(),
  title: text("title").notNull(),
  position: text("position").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const checklistItems = pgTable("checklist_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  checklistId: uuid("checklist_id").notNull(),
  boardId: uuid("board_id").notNull(),
  text: text("text").notNull(),
  completed: boolean("completed").notNull().default(false),
  position: text("position").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  cardId: uuid("card_id").notNull(),
  boardId: uuid("board_id").notNull(),
  authorId: uuid("author_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
});

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  cardId: uuid("card_id").notNull(),
  boardId: uuid("board_id").notNull(),
  storagePath: text("storage_path").notNull(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedBy: uuid("uploaded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const activity = pgTable("activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull(),
  cardId: uuid("card_id"),
  actorId: uuid("actor_id"),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const linkKind = pgEnum("link_kind", [
  "blocks",
  "is_blocked_by",
  "relates_to",
  "duplicates",
  "is_duplicated_by",
]);

export const cardLinks = pgTable("card_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromCardId: uuid("from_card_id").notNull(),
  toCardId: uuid("to_card_id").notNull(),
  kind: linkKind("kind").notNull(),
  boardId: uuid("board_id").notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sprintState = pgEnum("sprint_state", [
  "planned",
  "active",
  "completed",
]);

export const sprints = pgTable("sprints", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  goal: text("goal"),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  state: sprintState("state").notNull().default("planned"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipientUserId: uuid("recipient_user_id").notNull(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  relatedCardId: uuid("related_card_id"),
  relatedBoardId: uuid("related_board_id"),
  actorUserId: uuid("actor_user_id"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cardWatchers = pgTable(
  "card_watchers",
  {
    cardId: uuid("card_id").notNull(),
    userId: uuid("user_id").notNull(),
    boardId: uuid("board_id").notNull(),
    auto: boolean("auto").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cardId, t.userId] }) }),
);

export const userNotificationPrefs = pgTable(
  "user_notification_prefs",
  {
    userId: uuid("user_id").notNull(),
    kind: text("kind").notNull(),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.kind, t.channel] }) }),
);

export const worklogs = pgTable("worklogs", {
  id: uuid("id").primaryKey().defaultRandom(),
  cardId: uuid("card_id").notNull(),
  boardId: uuid("board_id").notNull(),
  userId: uuid("user_id").notNull(),
  minutes: integer("minutes").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const slaPolicies = pgTable("sla_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull(),
  name: text("name").notNull(),
  targetMin: integer("target_min").notNull(),
  appliesWhen: jsonb("applies_when").notNull().default(sql`'{}'::jsonb`),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cardSla = pgTable(
  "card_sla",
  {
    cardId: uuid("card_id").notNull(),
    slaId: uuid("sla_id").notNull(),
    boardId: uuid("board_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    breachedAt: timestamp("breached_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cardId, t.slaId] }) }),
);
