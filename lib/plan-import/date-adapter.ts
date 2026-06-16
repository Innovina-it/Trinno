// Adapter between the plan's "YYYY-MM-DD" date strings and the Date objects the
// app's DatePicker works in. Client-safe (no server-only): the review UI imports
// it. Anchored at UTC noon so the calendar day never shifts under a timezone.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isoToDate(iso: string): Date | null {
  if (!ISO_DATE.test(iso)) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dateToIso(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}
