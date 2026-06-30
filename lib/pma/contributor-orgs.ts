// PMA — contributor → organization resolution (PURE; no DB, no Drive).
//
// The analysis report attributes each document change to the editor's ORG
// instead of their name, when the workspace has mapped them. This module is the
// in-code resolver: it turns a file's contributors (name + email, from Drive)
// into report labels BEFORE anything reaches Gemini, so a mapped person's name
// never leaves the server. Mapped → the org; unmapped → the person's name
// verbatim (decision: report-only org attribution with a name fallback).
//
// Kept dependency-free on purpose: synthesize.ts imports it, and the synthesis
// unit tests must not drag in the DB client. The DB read/write lives in
// contributor-orgs-store.ts; run.ts fetches the entries and passes them here.

// One editor's Drive identity. Either field may be null (Drive doesn't always
// expose an email, and an anonymous revision exposes neither).
export type ContributorIdentity = { name: string | null; email: string | null };

// One row of the per-workspace map, reduced to what the resolver needs.
// `displayName` is the last-seen name stored alongside an email-keyed mapping; we
// also index by it so an email-mapped contributor still resolves when a Drive
// revision exposes only their name (revisions.list frequently omits emails).
export type ContributorOrgEntry = {
  identityKind: "email" | "name";
  identityKey: string;
  org: string;
  displayName?: string | null;
};

// Compiled lookup. Both emails AND names are matched case-insensitively
// (lowercased) — every identity originates from Drive's trimmed displayName /
// emailAddress, and a manually-typed name shouldn't fail to match on casing.
export type OrgMap = {
  byEmail: Map<string, string>;
  byName: Map<string, string>;
};

export function buildOrgMap(entries: ContributorOrgEntry[]): OrgMap {
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const e of entries) {
    const org = e.org?.trim();
    if (!org) continue;
    if (e.identityKind === "email") {
      const k = e.identityKey.trim().toLowerCase();
      if (k) byEmail.set(k, org);
    } else {
      const k = e.identityKey.trim().toLowerCase();
      if (k) byName.set(k, org);
    }
    // Cross-index the stored display name so EITHER identity field resolves:
    // an email-keyed mapping whose contributor shows up name-only (Drive gave no
    // email on that revision) still maps to the org instead of leaking the name.
    const dn = e.displayName?.trim().toLowerCase();
    if (dn) byName.set(dn, org);
  }
  return { byEmail, byName };
}

// Resolve ONE contributor to a report label. Email match first (stable identity),
// then display name (case-insensitive). Unmapped → the display name VERBATIM
// (original case); null only when Drive exposed neither name nor a mapped email
// (the caller applies its own "unknown"/anonymous default, as before this feature).
export function resolveContributorLabel(
  id: ContributorIdentity,
  map: OrgMap,
): string | null {
  const email = id.email?.trim().toLowerCase();
  if (email && map.byEmail.has(email)) return map.byEmail.get(email)!;
  const name = id.name?.trim();
  const nameKey = name?.toLowerCase();
  if (nameKey && map.byName.has(nameKey)) return map.byName.get(nameKey)!;
  return name || null;
}

// Resolve a SET of contributors to distinct labels, collapsing people from the
// same org to a single entry while preserving first-seen order. Drops nulls
// (anonymous/unexposed) — the caller decides how to render an empty result.
export function resolveContributorLabels(
  ids: ContributorIdentity[],
  map: OrgMap,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const label = resolveContributorLabel(id, map);
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}
