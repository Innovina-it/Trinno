import { describe, it, expect } from "vitest";
import {
  compareCards,
  timeOf,
  type SortableCard,
  type SortDir,
} from "@/lib/roadmap/list-sort";

const noOwner = () => null;

function card(over: Partial<SortableCard> & { title: string }): SortableCard {
  return {
    startDate: null,
    targetDate: null,
    completedAt: null,
    ...over,
  };
}

/** Helper: sort titles by a column/direction. */
function sortedTitles(
  cards: SortableCard[],
  key: Parameters<typeof compareCards>[2],
  dir: SortDir,
  ownerNameOf: (c: SortableCard) => string | null = noOwner,
): string[] {
  return cards
    .slice()
    .sort((a, b) => compareCards(a, b, key, dir, ownerNameOf))
    .map((c) => c.title);
}

describe("timeOf", () => {
  it("parses ISO strings (Supabase realtime shape)", () => {
    expect(timeOf("2026-05-14 07:00:00+00")).toBe(
      new Date("2026-05-14 07:00:00+00").getTime(),
    );
  });
  it("reads Date objects (RSC-hydrated snapshot shape)", () => {
    const d = new Date("2026-01-02T00:00:00Z");
    expect(timeOf(d)).toBe(d.getTime());
  });
  it("maps null / unparseable to +Infinity (sorts last)", () => {
    expect(timeOf(null)).toBe(Number.POSITIVE_INFINITY);
    expect(timeOf("not-a-date")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("compareCards — start date", () => {
  // Mirrors the real DB rows seen in the workspace.
  const cards = [
    card({ title: "Deflake CI", startDate: "2026-05-14 07:00:00+00" }),
    card({ title: "Schema audit", startDate: "2026-05-09 07:00:00+00" }),
    card({ title: "Add SSO", startDate: "2026-05-04 07:00:00+00" }),
    card({ title: "Refactor auth", startDate: "2026-04-29 07:00:00+00" }),
    card({ title: "Undated", startDate: null }),
  ];

  it("sorts ascending by start date, nulls last", () => {
    expect(sortedTitles(cards, "start", "asc")).toEqual([
      "Refactor auth",
      "Add SSO",
      "Schema audit",
      "Deflake CI",
      "Undated",
    ]);
  });

  it("sorts descending by start date, nulls STILL last", () => {
    expect(sortedTitles(cards, "start", "desc")).toEqual([
      "Deflake CI",
      "Schema audit",
      "Add SSO",
      "Refactor auth",
      "Undated",
    ]);
  });

  it("asc and desc actually differ (the reported bug)", () => {
    const asc = sortedTitles(cards, "start", "asc");
    const desc = sortedTitles(cards, "start", "desc");
    expect(asc).not.toEqual(desc);
  });

  it("works on real Date objects too", () => {
    const dateCards = cards.map((c) =>
      card({
        title: c.title,
        startDate:
          typeof c.startDate === "string" ? new Date(c.startDate) : c.startDate,
      }),
    );
    expect(sortedTitles(dateCards, "start", "asc")).toEqual(
      sortedTitles(cards, "start", "asc"),
    );
  });
});

describe("compareCards — target date", () => {
  const cards = [
    card({ title: "B", targetDate: "2026-05-19T00:00:00Z" }),
    card({ title: "A", targetDate: "2026-05-09T00:00:00Z" }),
    card({ title: "C", targetDate: "2026-05-30T00:00:00Z" }),
  ];
  it("ascending", () => {
    expect(sortedTitles(cards, "target", "asc")).toEqual(["A", "B", "C"]);
  });
  it("descending", () => {
    expect(sortedTitles(cards, "target", "desc")).toEqual(["C", "B", "A"]);
  });
});

describe("compareCards — title / owner / status", () => {
  it("title asc/desc", () => {
    const cards = [card({ title: "Charlie" }), card({ title: "Alpha" }), card({ title: "Bravo" })];
    expect(sortedTitles(cards, "title", "asc")).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(sortedTitles(cards, "title", "desc")).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("owner asc, unassigned last", () => {
    const owners: Record<string, string | null> = { x: "Zoe", y: "Anna", z: null };
    const cards = [
      card({ title: "x" }),
      card({ title: "y" }),
      card({ title: "z" }),
    ];
    const titles = sortedTitles(cards, "owner", "asc", (c) => owners[c.title] ?? null);
    expect(titles).toEqual(["y", "x", "z"]); // Anna, Zoe, then unassigned
  });

  it("status asc puts incomplete before complete", () => {
    const cards = [
      card({ title: "done", completedAt: "2026-05-01T00:00:00Z" }),
      card({ title: "open", completedAt: null }),
    ];
    expect(sortedTitles(cards, "status", "asc")).toEqual(["open", "done"]);
    expect(sortedTitles(cards, "status", "desc")).toEqual(["done", "open"]);
  });
});

describe("low-cardinality columns still toggle visibly (the reported owner bug)", () => {
  it("single owner: asc = mine first/unassigned last, desc = unassigned first/mine last", () => {
    // Mirrors the WP workspace: one owner ('team') on a few cards, rest null.
    const owners: Record<string, string | null> = {
      a: "team",
      b: "team",
      c: null,
      d: null,
    };
    const own = (x: SortableCard) => owners[x.title] ?? null;
    const cards = [card({ title: "a" }), card({ title: "b" }), card({ title: "c" }), card({ title: "d" })];

    const asc = sortedTitles(cards, "owner", "asc", own);
    const desc = sortedTitles(cards, "owner", "desc", own);

    expect(asc).toEqual(["a", "b", "c", "d"]); // assigned (a,b) first, unassigned (c,d) last
    expect(desc).toEqual(["d", "c", "b", "a"]); // unassigned (d,c) first, assigned (b,a) last
    expect(asc).not.toEqual(desc); // toggling flips the two groups
    expect(asc.slice(-2).sort()).toEqual(["c", "d"]); // unassigned last in asc
    expect(desc.slice(0, 2).sort()).toEqual(["c", "d"]); // unassigned first in desc
  });

  it("tied dates reverse on desc", () => {
    const cards = [
      card({ title: "Alpha", startDate: "2026-05-01T00:00:00Z" }),
      card({ title: "Bravo", startDate: "2026-05-01T00:00:00Z" }),
    ];
    expect(sortedTitles(cards, "start", "asc")).toEqual(["Alpha", "Bravo"]);
    expect(sortedTitles(cards, "start", "desc")).toEqual(["Bravo", "Alpha"]);
  });
});
