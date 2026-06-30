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
  date,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const workspaceRole = pgEnum("workspace_role", [
  "owner",
  "admin",
  "member",
  "guest",
]);
export const boardRole = pgEnum("board_role", ["admin", "member", "observer"]);
export const boardVisibility = pgEnum("board_visibility", [
  "private",
  "workspace",
]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull(),
  handle: text("handle").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  onboardingCompletedAt: timestamp("onboarding_completed_at", {
    withTimezone: true,
  }),
  // Migration 0090 — daily email digest opt-in. Default OFF; flipped by
  // the toggle in /settings/notifications. The digest cron reads only
  // rows where this is TRUE.
  emailDigestOptin: boolean("email_digest_optin").notNull().default(false),
  // Migration 0126 — "Notify me on every event" master toggle. Default OFF;
  // gates per-event delivery on EXTERNAL channels (email + telegram). The
  // server guard refuses enabling it until a channel can actually deliver.
  notifyPerEvent: boolean("notify_per_event").notNull().default(false),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  autoAssignCreator: boolean("auto_assign_creator").notNull().default(false),
  featureFlags: jsonb("feature_flags")
    .$type<Record<string, boolean>>()
    .notNull()
    .default(sql`jsonb_build_object()`),
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

export const workspaceInvitations = pgTable("workspace_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  email: text("email").notNull(),
  role: workspaceRole("role").notNull(),
  invitedBy: uuid("invited_by").notNull(),
  userId: uuid("user_id"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  // Invite-email send times (migration 0123). reminder_sent_at is also the
  // source for the 4-per-rolling-hour Resend cap; invite_email_sent_at is
  // logging only (the initial invite delivers via Supabase SMTP, uncapped).
  inviteEmailSentAt: timestamp("invite_email_sent_at", { withTimezone: true }),
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
});

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
    parentBoardId: uuid("parent_board_id"),
    parentCardId: uuid("parent_card_id"),
    position: integer("position").notNull().default(0),
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

export const listStatusKind = pgEnum("list_status_kind", [
  "todo",
  "in_progress",
  "review",
  "done",
  "blocked",
]);

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
  statusKind: listStatusKind("status_kind"),
  color: text("color"),
  // milestone-as-card — a hidden list never renders as a board column;
  // hosts type="milestone" cards so they stay off the board (migration 0135).
  hidden: boolean("hidden").notNull().default(false),
});

export const cardPriority = pgEnum("card_priority", [
  "p0",
  "p1",
  "p2",
  "p3",
  "p4",
]);

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
  startDate: timestamp("start_date", { withTimezone: true }),
  targetDate: timestamp("target_date", { withTimezone: true }),
  // Plan #16b-γ-G G1 — manual order axis for roadmap rows. NULL = unranked
  // (default sort: start_date ASC, created_at ASC). Sparse-int ranks
  // (Linear/Jira pattern) when set; collisions trigger a board renumber.
  roadmapOrder: integer("roadmap_order"),
  priority: cardPriority("priority"),
  coverKind: text("cover_kind").notNull().default("none"),
  coverValue: text("cover_value"),
  // milestone-as-card — emoji/icon shown on the roadmap marker label.
  // Null for non-milestone cards (migration 0136).
  icon: text("icon"),
  ownerId: uuid("owner_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // Roadmap completion sync: the list this card was in right before the
  // roadmap auto-moved it to 'done'. Consumed + cleared on un-complete.
  preDoneListId: uuid("pre_done_list_id"),
  // card-edit-concurrency — optimistic-concurrency token for TEXT edits.
  // Bumped by trigger (0134) only when title/description actually change.
  editRev: integer("edit_rev").notNull().default(0),
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
  parentCommentId: uuid("parent_comment_id"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by"),
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

export const linkScope = pgEnum("link_scope", ["workspace", "card"]);
export const linkPurpose = pgEnum("link_purpose", ["source", "reports"]);
// Delivery status tag on card-scope links (deliverables). Separate from the
// Open/Done completion logic; nullable so existing rows / workspace links stay
// status-less. Values mirror lib/links/status.ts.
export const deliveryStatus = pgEnum("delivery_status", [
  "to_do",
  "in_progress",
  "delivered",
  "approved",
  "blocked",
]);

export const links = pgTable("links", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: linkScope("scope").notNull(),
  // Discriminates the two workspace-scoped links (Shared folder vs Reports
  // folder). Card-scope rows keep the default 'source'. Defaults to 'source'
  // for backward compatibility.
  purpose: linkPurpose("purpose").notNull().default("source"),
  workspaceId: uuid("workspace_id").notNull(),
  cardId: uuid("card_id"),
  url: text("url").notNull(),
  color: text("color"),
  // Delivery status — card-scope only; NULL on workspace links and on cards
  // with no status set.
  status: deliveryStatus("status"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LinkRow = typeof links.$inferSelect;

export const roadmapBaselines = pgTable("roadmap_baselines", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  note: text("note"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  isApproved: boolean("is_approved").notNull().default(false),
});

export const roadmapBaselineEntries = pgTable("roadmap_baseline_entries", {
  baselineId: uuid("baseline_id").notNull(),
  cardId: uuid("card_id").notNull(),
  title: text("title").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }),
  targetDate: timestamp("target_date", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  roadmapOrder: integer("roadmap_order"),
  sprintId: uuid("sprint_id"),
  parentCardId: uuid("parent_card_id"),
}, (t) => ({ pk: primaryKey({ columns: [t.baselineId, t.cardId] }) }));

export const roadmapBaselineAssignees = pgTable("roadmap_baseline_assignees", {
  baselineId: uuid("baseline_id").notNull(),
  cardId: uuid("card_id").notNull(),
  userId: uuid("user_id").notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.baselineId, t.cardId, t.userId] }) }));

export const roadmapBaselineMilestones = pgTable("roadmap_baseline_milestones", {
  baselineId: uuid("baseline_id").notNull(),
  milestoneId: uuid("milestone_id").notNull(),
  name: text("name").notNull(),
  date: timestamp("date", { withTimezone: true }),
}, (t) => ({ pk: primaryKey({ columns: [t.baselineId, t.milestoneId] }) }));

export type RoadmapBaselineRow = typeof roadmapBaselines.$inferSelect;

export const sprintState = pgEnum("sprint_state", [
  "planned",
  "active",
  "completed",
]);

// Migration 0108 — per-workspace holiday calendar overrides. Defaults
// live in lib/holidays/it.ts; this table only stores deltas. A row with
// `name IS NULL` mutes the preset on that date; a row with non-null
// `name` either adds a custom day or renames the preset on that date.
export const workspaceHolidays = pgTable(
  "workspace_holidays",
  {
    workspaceId: uuid("workspace_id").notNull(),
    isoDate: date("iso_date").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspaceId, t.isoDate] }),
  }),
);

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

// Migration 0089 — sprint-assignment history. One row per
// (card, sprint) assignment with an open/close window so velocity can
// attribute completions to whichever sprint the card was IN at the
// moment `cards.completed_at` was set. Written exclusively by the
// `track_card_sprint_change` trigger.
export const cardSprintHistory = pgTable("card_sprint_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  cardId: uuid("card_id").notNull(),
  sprintId: uuid("sprint_id"),
  assignedAt: timestamp("assigned_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
});

// Migration 0091 — generic field-change audit. One row per tracked
// field that flipped on cards UPDATE: title / priority / owner_id /
// start_date / target_date / due_date / completed_at / sprint_id /
// parent_card_id / type / story_points / estimate_min. Written by the
// `cards_record_field_history` trigger (security definer).
export const cardFieldHistory = pgTable("card_field_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  cardId: uuid("card_id").notNull(),
  actorId: uuid("actor_id"),
  field: text("field").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedAt: timestamp("changed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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

// Migration 0124 — per-user external channel identity (e.g. Telegram chat id),
// channel-generic. Linked via a token handshake: pending -> linked -> revoked.
export const userChannelLinks = pgTable(
  "user_channel_links",
  {
    userId: uuid("user_id").notNull(),
    channel: text("channel").notNull(),
    externalId: text("external_id"),
    // Migration 0127 — the linked account's Telegram @username (no '@'), set
    // by the webhook on /start completion. Nullable: undefined on the inbound
    // update => null here; used only for display ("@handle · Connected").
    handle: text("handle"),
    linkTokenHash: text("link_token_hash"),
    linkTokenExp: timestamp("link_token_exp", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.channel] }) }),
);

// Migration 0124 — channel-neutral send ledger, one row per
// (notification, channel) attempt. Service-role only (RLS, no policies).
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    notificationId: uuid("notification_id").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.notificationId, t.channel] }) }),
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

export const rules = pgTable("rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull(),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  trigger: jsonb("trigger").notNull(),
  conditions: jsonb("conditions").notNull().default(sql`'{}'::jsonb`),
  actions: jsonb("actions").notNull().default(sql`'[]'::jsonb`),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ruleRuns = pgTable("rule_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ruleId: uuid("rule_id").notNull(),
  boardId: uuid("board_id").notNull(),
  status: text("status").notNull(),
  triggeredAt: timestamp("triggered_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  durationMs: integer("duration_ms").notNull().default(0),
  event: jsonb("event").notNull(),
  error: text("error"),
  actionResults: jsonb("action_results").notNull().default(sql`'[]'::jsonb`),
});

// Plan #10 — Components + Versions + Releases.

export const versionState = pgEnum("version_state", [
  "unreleased",
  "released",
  "archived",
]);

export const cardVersionKind = pgEnum("card_version_kind", [
  "affects",
  "fixes",
]);

export const components = pgTable("components", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull(),
  name: text("name").notNull(),
  leadUserId: uuid("lead_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cardComponents = pgTable(
  "card_components",
  {
    cardId: uuid("card_id").notNull(),
    componentId: uuid("component_id").notNull(),
    boardId: uuid("board_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cardId, t.componentId] }) }),
);

export const versions = pgTable("versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  semver: text("semver"),
  state: versionState("state").notNull().default("unreleased"),
  releaseDate: timestamp("release_date", { withTimezone: true }),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cardVersions = pgTable(
  "card_versions",
  {
    cardId: uuid("card_id").notNull(),
    versionId: uuid("version_id").notNull(),
    kind: cardVersionKind("kind").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cardId, t.versionId, t.kind] }) }),
);

// Plan #16b-γ-C (#4) — favorite boards.
//
// Per-(user, board) row keyed by composite PK. Cross-workspace; nav
// dropdown lists favorites flat across the whole boards graph the user
// can see. RLS gates SELECT/INSERT/DELETE to the row owner.
export const boardFavorites = pgTable(
  "board_favorites",
  {
    userId: uuid("user_id").notNull(),
    boardId: uuid("board_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.boardId] }) }),
);

// Plan #16b-γ-C (#5) — recently-viewed boards. Same composite-PK shape
// as favorites but `viewed_at` bumps on every visit via UPSERT so the
// nav dropdown can show the user's last 5 boards across workspaces.
export const recentViews = pgTable(
  "recent_views",
  {
    userId: uuid("user_id").notNull(),
    boardId: uuid("board_id").notNull(),
    viewedAt: timestamp("viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.boardId] }) }),
);

// Plan #16 — Dashboards + Gadgets.
export const dashboardScope = pgEnum("dashboard_scope", [
  "personal",
  "workspace",
]);

export const dashboards = pgTable("dashboards", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull(),
  scope: dashboardScope("scope").notNull(),
  workspaceId: uuid("workspace_id"),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const dashboardRole = pgEnum("dashboard_role", ["viewer", "editor"]);

export const dashboardMembers = pgTable(
  "dashboard_members",
  {
    dashboardId: uuid("dashboard_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: dashboardRole("role").notNull().default("viewer"),
    addedBy: uuid("added_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.dashboardId, t.userId] }) }),
);

export const gadgets = pgTable("gadgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  dashboardId: uuid("dashboard_id").notNull(),
  type: text("type").notNull(),
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  position: integer("position").notNull().default(0),
  size: text("size").notNull().default("1x1"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Milestones — first-class roadmap markers. Distinct from `versions`.
// Each milestone anchors to a specific date and optionally to a board.
export const milestones = pgTable("milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  boardId: uuid("board_id"),
  name: text("name").notNull(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  description: text("description"),
  color: text("color").notNull().default("#6366f1"),
  icon: text("icon"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

// ── PMA (Project Management Assistant) — Postgres data layer (migration 0128) ──
// Registry + run-history index ONLY (DESIGN §4.3, §4.4). KEYS / KIND / POINTERS
// — NO bulk content: recap and report TEXT live in the Drive OUTPUT folder (the
// system of record); these tables are a rebuildable projection of Drive. RLS is
// workspace-scoped on both (SELECT for members; writes are service-role only).
// `kind`/`state` are text + CHECK in SQL (the repo convention), so no pgEnum.

export const pmaFileRegistry = pgTable("pma_file_registry", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  // Drive fileId in the SOURCE folder; unique per workspace.
  sourceFileId: text("source_file_id").notNull(),
  name: text("name"),
  parentFolderId: text("parent_folder_id"),
  mimeType: text("mime_type"),
  // 'editable' | 'non_mod' (computed each run; CHECK-enforced in SQL).
  kind: text("kind"),
  isDeliverable: boolean("is_deliverable").notNull().default(false),
  cardLinkId: uuid("card_link_id"),
  // headRevisionId — the version-gate checkpoint.
  lastVersion: text("last_version"),
  lastAnalyzedAt: timestamp("last_analyzed_at", { withTimezone: true }),
  // 'active' | 'removed' | 'error' (CHECK-enforced in SQL).
  state: text("state").notNull().default("active"),
  // Drive fileId of the latest recap in the OUTPUT folder (deprecated by U12.1 —
  // no longer written; the recap body now lives in recap_json below).
  recapFileId: text("recap_file_id"),
  // U12.1 — the structured per-file recap, moved from the Drive recaps/ folder
  // into Postgres. Null for files not yet analysed (or non_mod).
  recapJson: jsonb("recap_json").$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PmaFileRegistryRow = typeof pmaFileRegistry.$inferSelect;

export const pmaAnalysisRuns = pgTable("pma_analysis_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  triggeredBy: uuid("triggered_by"),
  status: text("status"),
  // { changed, missed, removed } — counts only, no content.
  counts: jsonb("counts").$type<Record<string, number>>(),
  // Drive fileId of the report Google Doc.
  reportFileId: text("report_file_id"),
  // webViewLink the Analysis tab surfaces.
  reportWebViewLink: text("report_web_view_link"),
  // U12.12 — the run's date window (null = whole-document run) + a content
  // fingerprint ({fileId: driveVersion}) for same-range dedup.
  windowStart: timestamp("window_start", { withTimezone: true }),
  windowEnd: timestamp("window_end", { withTimezone: true }),
  fingerprint: jsonb("fingerprint").$type<Record<string, string>>(),
});

export type PmaAnalysisRunRow = typeof pmaAnalysisRuns.$inferSelect;

// Per-workspace PMA operational state (DESIGN §4.5). Currently the Drive Changes
// API checkpoint that makes a run incremental; one row per workspace. RLS:
// member SELECT, service-role writes (mirrors the registry/runs tables).
export const pmaWorkspaceState = pgTable("pma_workspace_state", {
  workspaceId: uuid("workspace_id").primaryKey(),
  changesPageToken: text("changes_page_token"),
  // Per-workspace report-section selection (migration 0141): a {key: bool} map
  // of which synthesis-report sections to render. null → all on. See
  // lib/pma/report-sections.ts.
  reportSections: jsonb("report_sections"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PmaWorkspaceStateRow = typeof pmaWorkspaceState.$inferSelect;

// Per-workspace contributor → organization map (migration 0142). Lets the
// analysis report credit the ORG that an editor belongs to instead of the
// person. Match key is (identity_kind, identity_key): 'email' (lowercased Drive
// emailAddress) preferred, else 'name' (trimmed displayName). Maintained by hand
// in workspace Settings; an empty map → reports unchanged (name fallback). RLS:
// member SELECT, owner/admin write (mirrors workspace_holidays, NOT the
// service-role-only PMA tables — this one is user-edited).
export const pmaContributorOrgs = pgTable(
  "pma_contributor_orgs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    // 'email' | 'name' (CHECK-enforced in SQL).
    identityKind: text("identity_kind").notNull(),
    identityKey: text("identity_key").notNull(),
    displayName: text("display_name"),
    org: text("org").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uq: unique().on(t.workspaceId, t.identityKind, t.identityKey),
  }),
);

export type PmaContributorOrgRow = typeof pmaContributorOrgs.$inferSelect;
