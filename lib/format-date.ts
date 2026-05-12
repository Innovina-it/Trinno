// Single source of truth for date display formatting.
// Returns dd/mm/yyyy. Accepts Date | string | null | undefined; empty for null.
export function formatDate(d: Date | string | null | undefined): string {
  if (d == null) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

// dd/mm/yyyy HH:MM — for activity / history rows that show both.
export function formatDateTime(d: Date | string | null | undefined): string {
  if (d == null) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hh}:${mm}`;
}
