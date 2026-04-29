// Editorial-industrial code formatting helpers.
// Card and board IDs are surfaced as `#TR-XXXXXX` / `#BD-XXXXXX` callouts
// rendered in JetBrains Mono uppercase, modeled after machine-tool part
// numbers and tracking codes in industrial documentation.

function shortHex(id: string): string {
  return id.replace(/-/g, "").slice(0, 6).toUpperCase();
}

export function cardCode(id: string): string {
  return "TR-" + shortHex(id);
}

export function boardCode(id: string): string {
  return "BD-" + shortHex(id);
}

// Roman numeral for list column ordinals (caps at L = 50, plenty for kanban).
export function roman(n: number): string {
  if (n <= 0) return String(n);
  const map: [number, string][] = [
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  let v = n;
  for (const [val, sym] of map) {
    while (v >= val) {
      out += sym;
      v -= val;
    }
  }
  return out;
}

// ISO-ish date for due pills: "DUE 2026-05-04"
export function dueCode(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Compact relative timestamp for marginalia: "29 APR".
export function shortDate(d: Date): string {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]}`;
}
