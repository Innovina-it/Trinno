"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  upsertContributorOrgAction,
  deleteContributorOrgAction,
  scanContributorsAction,
  type ScannedContributor,
} from "@/actions/pma-orgs";
import type { ContributorOrgRow } from "@/lib/pma/contributor-orgs-store";

// Workspace Settings → "Organizations": maps each contributor (Drive editor) to
// the organization they belong to, so analysis reports credit the org instead of
// the person. A contributor with no mapping falls back to their name in reports.
// Editing is owner/admin only; "Scan contributors" reads who has edited the
// workspace's documents so orgs can be assigned from real names, not guesses.

const kindOf = (value: string): "email" | "name" =>
  value.includes("@") ? "email" : "name";

// A scanned editor's stable key + label for the assign form.
function scanKey(c: ScannedContributor): { kind: "email" | "name"; key: string } {
  return c.email
    ? { kind: "email", key: c.email }
    : { kind: "name", key: c.name ?? "" };
}

export function ContributorOrgsPanel({
  workspaceId,
  initialRows,
  canEdit,
  orgHints = [],
}: {
  workspaceId: string;
  initialRows: ContributorOrgRow[];
  canEdit: boolean;
  // Org names already present in the workspace's roadmap (the "· Partner" suffix
  // the plan import stamps onto task cards), offered as autocomplete suggestions
  // even before any contributor is mapped.
  orgHints?: string[];
}) {
  const [rows, setRows] = useState<ContributorOrgRow[]>(initialRows);
  const [contributor, setContributor] = useState("");
  const [org, setOrg] = useState("");
  const [scanned, setScanned] = useState<ScannedContributor[] | null>(null);
  const [pending, start] = useTransition();
  const [scanning, setScanning] = useState(false);

  function refreshRow(saved: {
    identityKind: "email" | "name";
    identityKey: string;
    displayName: string | null;
    org: string;
  }) {
    setRows((prev) => {
      const i = prev.findIndex(
        (r) => r.identityKind === saved.identityKind && r.identityKey === saved.identityKey,
      );
      // Optimistic; the real id arrives on the next page load (revalidatePath).
      const next: ContributorOrgRow = {
        id: i >= 0 ? prev[i].id : `tmp-${saved.identityKind}-${saved.identityKey}`,
        identityKind: saved.identityKind,
        identityKey: saved.identityKey,
        displayName: saved.displayName,
        org: saved.org,
      };
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = next;
        return copy;
      }
      return [...prev, next];
    });
  }

  function save(input: {
    identityKind: "email" | "name";
    identityKey: string;
    displayName?: string | null;
    org: string;
  }) {
    const identityKey = input.identityKey.trim();
    const orgName = input.org.trim();
    if (!identityKey || !orgName) {
      toast.error("Both a contributor and an organization are required.");
      return;
    }
    start(async () => {
      const res = await upsertContributorOrgAction({ workspaceId, ...input, identityKey, org: orgName });
      if (res.ok) {
        refreshRow({
          identityKind: input.identityKind,
          identityKey:
            input.identityKind === "email" ? identityKey.toLowerCase() : identityKey,
          displayName: input.displayName?.trim() || null,
          org: orgName,
        });
        toast.success("Saved");
      } else {
        toast.error(res.error);
      }
    });
  }

  function addManual(e: React.FormEvent) {
    e.preventDefault();
    const value = contributor.trim();
    save({ identityKind: kindOf(value), identityKey: value, org });
    setContributor("");
    setOrg("");
  }

  function remove(row: ContributorOrgRow) {
    start(async () => {
      const res = await deleteContributorOrgAction({ workspaceId, id: row.id });
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.id !== row.id));
        toast.success("Removed");
      } else {
        toast.error(res.error);
      }
    });
  }

  function scan() {
    setScanning(true);
    start(async () => {
      const res = await scanContributorsAction(workspaceId);
      setScanning(false);
      if (res.ok) {
        setScanned(res.contributors);
        if (res.contributors.length === 0)
          toast.message("No editors found in the source folder yet.");
      } else {
        toast.error(res.error);
      }
    });
  }

  // Contributors already mapped, to grey out in the scan list.
  const mappedKeys = new Set(
    rows.map((r) => `${r.identityKind}:${r.identityKey.toLowerCase()}`),
  );

  // Autocomplete suggestions: orgs already mapped here PLUS orgs already named in
  // the roadmap (the "· Partner" suffix on task cards), so the same org is reused
  // instead of retyped with a different casing/typo — populated from day one.
  const orgSuggestions = Array.from(
    new Set(
      [...rows.map((r) => r.org), ...orgHints].map((o) => o.trim()).filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <datalist id="org-suggestions">
        {orgSuggestions.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <p className="text-xs text-fg-faint">
        Reports credit the organization a contributor belongs to instead of their
        name. Anyone not listed here keeps their name in the report. Editable by
        owners and admins.
      </p>

      {rows.length > 0 ? (
        <ul className="divide-y divide-hairline rounded-lg border border-hairline">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <span className="block truncate text-sm text-fg">
                  {row.displayName || row.identityKey}
                  <span className="ml-2 mono-meta-sm text-fg-faint">
                    {row.identityKind === "email" ? row.identityKey : "name"}
                  </span>
                </span>
                <span className="block truncate text-xs text-fg-muted">
                  → {row.org}
                </span>
              </div>
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => remove(row)}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-faint">No organizations mapped yet.</p>
      )}

      {canEdit && (
        <>
          <form onSubmit={addManual} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="org-contributor">Contributor (name or email)</Label>
              <Input
                id="org-contributor"
                value={contributor}
                onChange={(e) => setContributor(e.target.value)}
                placeholder="amir@innovina.it"
                className="w-56"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="org-name">Organization</Label>
              <Input
                id="org-name"
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                placeholder="Innovina"
                list="org-suggestions"
                className="w-44"
              />
            </div>
            <Button type="submit" disabled={pending || !contributor.trim() || !org.trim()}>
              Add
            </Button>
          </form>

          <div className="space-y-2">
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={scan}>
              {scanning ? "Scanning…" : "Scan contributors"}
            </Button>
            {scanned && scanned.length > 0 && (
              <ul className="divide-y divide-hairline rounded-lg border border-hairline">
                {scanned.map((c, i) => {
                  const { kind, key } = scanKey(c);
                  const already = mappedKeys.has(`${kind}:${key.toLowerCase()}`);
                  return (
                    <li
                      key={key || c.name || `scan-${i}`}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm text-fg">
                        {c.name || c.email}
                        {c.email && c.name && (
                          <span className="ml-2 mono-meta-sm text-fg-faint">{c.email}</span>
                        )}
                      </span>
                      {already ? (
                        <span className="mono-meta-sm text-fg-faint">mapped</span>
                      ) : (
                        <ScanAssign
                          disabled={pending}
                          onAssign={(orgName) =>
                            save({
                              identityKind: kind,
                              identityKey: key,
                              displayName: c.name,
                              org: orgName,
                            })
                          }
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Inline "org + add" for one scanned contributor.
function ScanAssign({
  onAssign,
  disabled,
}: {
  onAssign: (org: string) => void;
  disabled: boolean;
}) {
  const [org, setOrg] = useState("");
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Input
        value={org}
        onChange={(e) => setOrg(e.target.value)}
        placeholder="Organization"
        list="org-suggestions"
        className="w-36"
        aria-label="Organization"
      />
      <Button
        type="button"
        size="sm"
        disabled={disabled || !org.trim()}
        onClick={() => {
          onAssign(org.trim());
          setOrg("");
        }}
      >
        Add
      </Button>
    </div>
  );
}
