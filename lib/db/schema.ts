import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
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
});
