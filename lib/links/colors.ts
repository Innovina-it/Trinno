export type LinkColorKey = "giallo" | "arancione" | "blu" | "rosso" | "verde";
export const LINK_COLORS: { key: LinkColorKey; label: string; hex: string }[] = [
  { key: "giallo",    label: "Yellow",    hex: "#facc15" },
  { key: "arancione", label: "Orange",    hex: "#fb923c" },
  { key: "blu",       label: "Blue",      hex: "#3b82f6" },
  { key: "rosso",     label: "Red",       hex: "#ef4444" },
  { key: "verde",     label: "Green",     hex: "#22c55e" },
];
export const DEFAULT_LINK_COLOR = LINK_COLORS[0].hex;
