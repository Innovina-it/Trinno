export type LaneMode = "none" | "assignee" | "parent" | "label" | "sprint" | "type";

export type Filters = {
  types: string[];
  labelIds: string[];
  due: "overdue" | "this-week" | null;
  assignedToMe: boolean;
};

type FilterCard = {
  id: string; title: string; archived: boolean;
  type?: string | null;
  parentCardId?: string | null;
  dueDate?: Date | string | null;
  dueComplete?: boolean | null;
  sprintId?: string | null;
};

export function parseFilters(sp: URLSearchParams): Filters {
  const types = (sp.get("type") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const labelIds = (sp.get("label") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const due = sp.get("due") as Filters["due"];
  // Canonical query key is `assignee=me` (matches Jira convention).
  // `me=1` is NOT supported.
  const assignedToMe = sp.get("assignee") === "me";
  return {
    types,
    labelIds,
    due: due === "overdue" || due === "this-week" ? due : null,
    assignedToMe,
  };
}

export function serializeFilters(f: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.types.length) sp.set("type", f.types.join(","));
  if (f.labelIds.length) sp.set("label", f.labelIds.join(","));
  if (f.due) sp.set("due", f.due);
  if (f.assignedToMe) sp.set("assignee", "me");
  return sp;
}

export function isFilterActive(f: Filters): boolean {
  return f.types.length > 0 || f.labelIds.length > 0 || f.due !== null || f.assignedToMe;
}

export function applyFilters<T extends FilterCard>(
  cards: T[],
  ctx: {
    cardLabels: { cardId: string; labelId: string }[];
    cardMembers: { cardId: string; userId: string }[];
    currentUserId?: string | null;
  },
  f: Filters,
): T[] {
  if (!isFilterActive(f)) return cards;
  const labelByCard = new Map<string, Set<string>>();
  for (const cl of ctx.cardLabels) {
    const s = labelByCard.get(cl.cardId) ?? new Set();
    s.add(cl.labelId);
    labelByCard.set(cl.cardId, s);
  }
  const memberByCard = new Map<string, Set<string>>();
  for (const cm of ctx.cardMembers) {
    const s = memberByCard.get(cm.cardId) ?? new Set();
    s.add(cm.userId);
    memberByCard.set(cm.cardId, s);
  }
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
  return cards.filter((c) => {
    if (f.types.length && !f.types.includes(c.type ?? "task")) return false;
    if (f.labelIds.length) {
      const labels = labelByCard.get(c.id);
      if (!labels) return false;
      for (const id of f.labelIds) if (!labels.has(id)) return false;
    }
    if (f.due) {
      if (!c.dueDate) return false;
      const d = c.dueDate instanceof Date ? c.dueDate : new Date(c.dueDate);
      if (f.due === "overdue") {
        if (d > now) return false;
        if (c.dueComplete) return false;
      } else if (f.due === "this-week") {
        if (d < now || d > weekAhead) return false;
      }
    }
    if (f.assignedToMe) {
      if (!ctx.currentUserId) return false;
      const mems = memberByCard.get(c.id);
      if (!mems || !mems.has(ctx.currentUserId)) return false;
    }
    return true;
  });
}

export type Lane = { key: string; label: string; cardIds: string[] };

export function partitionLanes(
  cards: FilterCard[],
  mode: LaneMode,
  ctx: {
    cardMembers?: { cardId: string; userId: string }[];
    cardLabels?: { cardId: string; labelId: string }[];
    profiles?: { id: string; displayName: string }[];
    labels?: { id: string; name: string; color?: string }[];
    sprints?: { id: string; name: string }[];
  },
): Lane[] {
  if (mode === "none") return [{ key: "", label: "", cardIds: cards.map((c) => c.id) }];

  const lanes = new Map<string, string[]>();
  const ensure = (k: string) => {
    if (!lanes.has(k)) lanes.set(k, []);
    return lanes.get(k)!;
  };

  if (mode === "assignee") {
    const memMap = new Map<string, string[]>();
    for (const cm of ctx.cardMembers ?? []) {
      const arr = memMap.get(cm.cardId) ?? [];
      arr.push(cm.userId);
      memMap.set(cm.cardId, arr);
    }
    for (const c of cards) {
      const mems = memMap.get(c.id) ?? [];
      if (mems.length === 0) ensure("").push(c.id);
      else for (const u of mems) ensure(u).push(c.id);
    }
    const out: Lane[] = [];
    for (const [k, ids] of lanes) {
      const label = k === ""
        ? "Unassigned"
        : ctx.profiles?.find((p) => p.id === k)?.displayName ?? "Member";
      out.push({ key: k, label, cardIds: ids });
    }
    return sortLanes(out);
  }

  if (mode === "parent") {
    for (const c of cards) {
      ensure(c.parentCardId ?? "").push(c.id);
    }
    const titleByCard = new Map(cards.map((c) => [c.id, c.title]));
    const out: Lane[] = [];
    for (const [k, ids] of lanes) {
      const label = k === "" ? "No parent" : titleByCard.get(k) ?? `#${k.slice(0, 6)}`;
      out.push({ key: k, label, cardIds: ids });
    }
    return sortLanes(out);
  }

  if (mode === "label") {
    const labMap = new Map<string, string[]>();
    for (const cl of ctx.cardLabels ?? []) {
      const arr = labMap.get(cl.cardId) ?? [];
      arr.push(cl.labelId);
      labMap.set(cl.cardId, arr);
    }
    for (const c of cards) {
      const labs = labMap.get(c.id) ?? [];
      if (labs.length === 0) ensure("").push(c.id);
      else for (const l of labs) ensure(l).push(c.id);
    }
    const out: Lane[] = [];
    for (const [k, ids] of lanes) {
      const label = k === ""
        ? "No label"
        : ctx.labels?.find((l) => l.id === k)?.name || `#${k.slice(0, 6)}`;
      out.push({ key: k, label, cardIds: ids });
    }
    return sortLanes(out);
  }

  if (mode === "sprint") {
    for (const c of cards) {
      ensure(c.sprintId ?? "").push(c.id);
    }
    const out: Lane[] = [];
    for (const [k, ids] of lanes) {
      const label = k === ""
        ? "Backlog"
        : ctx.sprints?.find((s) => s.id === k)?.name || `#${k.slice(0, 6)}`;
      out.push({ key: k, label, cardIds: ids });
    }
    return sortLanes(out);
  }

  if (mode === "type") {
    const TYPE_ORDER = ["epic", "story", "task", "subtask", "bug"] as const;
    const TYPE_LABELS: Record<string, string> = {
      epic: "Epic",
      story: "Story",
      task: "Task",
      subtask: "Sub-task",
      bug: "Bug",
    };
    for (const c of cards) {
      const t = c.type ?? "task";
      ensure(t).push(c.id);
    }
    const out: Lane[] = [];
    for (const t of TYPE_ORDER) {
      const ids = lanes.get(t);
      if (!ids || ids.length === 0) continue;
      out.push({ key: t, label: TYPE_LABELS[t], cardIds: ids });
    }
    // Surface any unknown types after the canonical order, alphabetised.
    const extras: Lane[] = [];
    for (const [k, ids] of lanes) {
      if ((TYPE_ORDER as readonly string[]).includes(k)) continue;
      extras.push({ key: k, label: TYPE_LABELS[k] ?? k, cardIds: ids });
    }
    extras.sort((a, b) => a.label.localeCompare(b.label));
    return [...out, ...extras];
  }

  return [{ key: "", label: "", cardIds: cards.map((c) => c.id) }];
}

function sortLanes(lanes: Lane[]): Lane[] {
  // Empty/Unassigned/Backlog last; others alphabetical by label.
  return lanes.sort((a, b) => {
    if (a.key === "" && b.key !== "") return 1;
    if (b.key === "" && a.key !== "") return -1;
    return a.label.localeCompare(b.label);
  });
}
