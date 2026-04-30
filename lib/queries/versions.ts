import { eq, asc, and, inArray } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  versions,
  cardVersions,
  cards,
  boards,
  cardComponents,
  components,
} from "@/lib/db/schema";
import { cardCode } from "@/lib/format";

export async function listVersions(token: string, workspaceId: string) {
  return dbAsUser(token, async (tx) =>
    tx
      .select()
      .from(versions)
      .where(eq(versions.workspaceId, workspaceId))
      .orderBy(asc(versions.releaseDate), asc(versions.name)),
  );
}

export async function getVersion(token: string, id: string) {
  return dbAsUser(token, async (tx) => {
    const rows = await tx.select().from(versions).where(eq(versions.id, id));
    return rows[0] ?? null;
  });
}

export type VersionCardRow = {
  cardId: string;
  cardTitle: string;
  cardArchived: boolean;
  cardStoryPoints: number | null;
  cardDueComplete: boolean;
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  parentCardId: string | null;
  kind: "affects" | "fixes";
  componentNames: string[];
};

/**
 * Returns one row per (card, kind) that targets the given version.
 * Component names are aggregated server-side.
 *
 * Archived cards are excluded — the release page is intended for active work.
 */
export async function listVersionCards(
  token: string,
  versionId: string,
): Promise<VersionCardRow[]> {
  return dbAsUser(token, async (tx) => {
    const baseRows = await tx
      .select({
        cardId: cards.id,
        cardTitle: cards.title,
        cardArchived: cards.archived,
        cardStoryPoints: cards.storyPoints,
        cardDueComplete: cards.dueComplete,
        boardId: cards.boardId,
        boardTitle: boards.title,
        workspaceId: boards.workspaceId,
        parentCardId: cards.parentCardId,
        kind: cardVersions.kind,
      })
      .from(cardVersions)
      .innerJoin(cards, eq(cards.id, cardVersions.cardId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(
        and(
          eq(cardVersions.versionId, versionId),
          eq(cards.archived, false),
        ),
      );

    if (baseRows.length === 0) return [];

    // Pull components for the relevant cards in one go, grouped client-side.
    const cardIds = Array.from(new Set(baseRows.map((r) => r.cardId)));
    const compRows = await tx
      .select({
        cardId: cardComponents.cardId,
        componentName: components.name,
      })
      .from(cardComponents)
      .innerJoin(components, eq(components.id, cardComponents.componentId))
      .where(inArray(cardComponents.cardId, cardIds));

    const byCard = new Map<string, string[]>();
    for (const r of compRows as Array<{ cardId: string; componentName: string }>) {
      const arr = byCard.get(r.cardId) ?? [];
      arr.push(r.componentName);
      byCard.set(r.cardId, arr);
    }

    return baseRows.map((r) => ({
      ...r,
      componentNames: (byCard.get(r.cardId) ?? []).sort(),
    }));
  });
}

function escapeMd(s: string): string {
  return s.replace(/[\[\]]/g, "\\$&");
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function releaseNotesMarkdown(
  token: string,
  versionId: string,
): Promise<string> {
  const version = await getVersion(token, versionId);
  if (!version) return "# Version not found\n";
  const cardsRows = await listVersionCards(token, versionId);
  const fixes = cardsRows.filter((c) => c.kind === "fixes");

  // Group by primary component name (first sorted) — falls back to "Uncategorised".
  const groups = new Map<string, VersionCardRow[]>();
  for (const c of fixes) {
    const key = c.componentNames[0] ?? "Uncategorised";
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  const groupKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === "Uncategorised") return 1;
    if (b === "Uncategorised") return -1;
    return a.localeCompare(b);
  });

  const lines: string[] = [];
  const titleParts = [version.name];
  if (version.semver) titleParts.push(version.semver);
  const dateStr = version.releaseDate
    ? fmtDate(new Date(version.releaseDate))
    : version.state.toUpperCase();
  lines.push(`# ${titleParts.join(" — ")} — ${dateStr}`);
  if (version.description) {
    lines.push("");
    lines.push(version.description);
  }
  lines.push("");
  if (fixes.length === 0) {
    lines.push("_No cards fixed in this release._");
    return lines.join("\n") + "\n";
  }

  for (const key of groupKeys) {
    lines.push(`## ${key}`);
    const rows = groups.get(key)!;
    for (const c of rows) {
      const code = cardCode(c.cardId);
      const title = escapeMd(c.cardTitle);
      // Use a relative link path; consumers are expected to view the markdown
      // inside the app where /b/.../c/... resolves cleanly.
      const href = `/b/${c.boardId}/c/${c.cardId}`;
      lines.push(`- [${code}](${href}) ${title}`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}
