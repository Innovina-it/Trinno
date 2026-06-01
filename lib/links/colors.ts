export type LinkColorKey = "giallo" | "arancione" | "blu" | "rosso" | "verde";
export const LINK_COLORS: { key: LinkColorKey; label: string; hex: string }[] = [
  { key: "giallo",    label: "Giallo",    hex: "#facc15" },
  { key: "arancione", label: "Arancione", hex: "#fb923c" },
  { key: "blu",       label: "Blu",       hex: "#3b82f6" },
  { key: "rosso",     label: "Rosso",     hex: "#ef4444" },
  { key: "verde",     label: "Verde",     hex: "#22c55e" },
];
export const DEFAULT_LINK_COLOR = LINK_COLORS[0].hex;
