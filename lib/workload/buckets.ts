// Pure helpers for bucketing workload cards into ISO weeks.
//
// "Load" per week is currently sum(estimateMin) when set, falling back to
// one card-week if the estimate is missing — gives a sensible signal even
// before teams start estimating. Card span is clipped to each week's
// intersection so a 3-week card splits 1/3 across three buckets.

export type WeekBucket = {
  isoYear: number;
  isoWeek: number;
  // UTC start (Monday 00:00) and end (Monday next 00:00, exclusive).
  start: Date;
  end: Date;
  // Sum of clipped estimate-minutes (or 1 card-week if estimate null).
  load: number;
  cardIds: string[];
};

export function startOfIsoWeekUtc(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Monday = 1; getUTCDay() returns 0 (Sun) .. 6 (Sat).
  const dow = x.getUTCDay();
  const offsetToMon = (dow + 6) % 7;
  x.setUTCDate(x.getUTCDate() - offsetToMon);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export function isoWeek(d: Date): { year: number; week: number } {
  // ISO 8601: week with year's first Thursday is week 1.
  const t = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const firstDow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDow + 3);
  const diffMs = t.getTime() - firstThursday.getTime();
  const week = 1 + Math.round(diffMs / (7 * 86_400_000));
  return { year: t.getUTCFullYear(), week };
}

export function bucketsBetween(start: Date, end: Date): WeekBucket[] {
  const out: WeekBucket[] = [];
  let cur = startOfIsoWeekUtc(start);
  const stop = startOfIsoWeekUtc(end);
  while (cur.getTime() <= stop.getTime()) {
    const next = new Date(cur.getTime() + 7 * 86_400_000);
    const iso = isoWeek(cur);
    out.push({
      isoYear: iso.year,
      isoWeek: iso.week,
      start: new Date(cur),
      end: next,
      load: 0,
      cardIds: [],
    });
    cur = next;
  }
  return out;
}

export type LoadCard = {
  id: string;
  startDate: Date;
  targetDate: Date;
  estimateMin: number | null;
};

// Spread a card's estimate across the weeks its span overlaps. If the
// estimate is null, contribute one "card-day-ish" unit per week so the
// histogram still moves.
export function fillBuckets(buckets: WeekBucket[], cards: LoadCard[]): WeekBucket[] {
  const totalMs = (c: LoadCard) =>
    Math.max(86_400_000, c.targetDate.getTime() - c.startDate.getTime() + 86_400_000);
  for (const b of buckets) {
    for (const c of cards) {
      const overlapStart = Math.max(c.startDate.getTime(), b.start.getTime());
      const overlapEnd = Math.min(
        c.targetDate.getTime() + 86_400_000,
        b.end.getTime(),
      );
      const overlap = overlapEnd - overlapStart;
      if (overlap <= 0) continue;
      const total = totalMs(c);
      const fraction = overlap / total;
      const load = c.estimateMin != null
        ? c.estimateMin * fraction
        : fraction; // synthetic "card-fraction" units when un-estimated
      b.load += load;
      b.cardIds.push(c.id);
    }
  }
  return buckets;
}
