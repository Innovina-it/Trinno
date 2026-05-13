import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import {
  getVersion,
  listVersionCards,
  type VersionCardRow,
} from "@/lib/queries/versions";
import { cardCode } from "@/lib/format";
import { formatDate } from "@/lib/format-date";

const STATE_BADGE: Record<string, string> = {
  unreleased: "border-fg/40 text-fg/80",
  released: "border-[color:var(--accent-cyan)] text-[color:var(--accent-cyan)]",
  archived: "border-fg/20 text-fg/40",
};

export default async function VersionDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; versionId: string }>;
}) {
  const { workspaceId, versionId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const version = await getVersion(token, versionId);
  if (!version || version.workspaceId !== workspaceId) notFound();
  const cards = await listVersionCards(token, versionId);

  const fixes = cards.filter((c) => c.kind === "fixes");
  const affects = cards.filter((c) => c.kind === "affects");
  const totalCards = cards.length;
  const totalFixes = fixes.length;
  const totalAffects = affects.length;
  const totalStoryPoints = fixes.reduce(
    (acc, c) => acc + (c.cardStoryPoints ?? 0),
    0,
  );
  const completedStoryPoints = fixes
    .filter((c) => c.cardDueComplete)
    .reduce((acc, c) => acc + (c.cardStoryPoints ?? 0), 0);

  // Group fixes by component name (Uncategorised last).
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

  return (
    <div className="mx-auto max-w-5xl px-3 sm:px-4 md:px-6 py-6 md:py-10 space-y-10">
      <header className="space-y-3 border-b border-hairline pb-6">
        <Link
          href={`/w/${workspaceId}/versions`}
          className="mono-meta-sm text-fg-muted hover:text-fg"
        >
          ← All versions
        </Link>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="serif-display text-5xl">{version.name}</h1>
          {version.semver && (
            <span className="chip">{version.semver}</span>
          )}
          <span
            className={`mono-meta-sm border px-2 py-0.5 ${
              STATE_BADGE[version.state] ?? ""
            }`}
          >
            {version.state.toUpperCase()}
          </span>
          {version.releaseDate && (
            <span className="mono-meta-sm text-fg-muted tabular-nums">
              {formatDate(version.releaseDate)}
            </span>
          )}
        </div>
        {version.description && (
          <p className="text-fg-muted whitespace-pre-wrap">
            {version.description}
          </p>
        )}
      </header>

      <section
        className="grid gap-3 grid-cols-2 sm:grid-cols-4"
        data-testid="version-progress"
      >
        <Stat label="Total cards" value={totalCards} />
        <Stat label="Fixes" value={totalFixes} />
        <Stat label="Affects" value={totalAffects} />
        <Stat
          label="Story pts (done / total)"
          value={`${completedStoryPoints} / ${totalStoryPoints}`}
        />
      </section>

      <section className="space-y-6">
        {groupKeys.length === 0 ? (
          <p className="font-serif italic text-fg-faint">
            No cards target this version yet.
          </p>
        ) : (
          groupKeys.map((key) => (
            <div key={key} className="space-y-2">
              <h2 className="mono-meta text-fg">{key}</h2>
              <ul className="divide-y divide-hairline glass rounded-2xl">
                {(groups.get(key) ?? []).map((c) => (
                  <li
                    key={c.cardId}
                    className="px-4 py-3 flex items-center gap-3"
                    data-card-id={c.cardId}
                  >
                    <span className="chip">FIXES</span>
                    <Link
                      href={`/b/${c.boardId}/c/${c.cardId}`}
                      className="flex-1 hover:text-[color:var(--accent-cyan)] truncate"
                    >
                      {c.cardTitle}
                    </Link>
                    <span className="mono-meta-sm text-fg-faint truncate max-w-[20ch]">
                      {c.boardTitle}
                    </span>
                    <span className="mono-meta-sm text-fg-faint tabular-nums">
                      {cardCode(c.cardId)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}

        {affects.length > 0 && (
          <div className="space-y-2">
            <h2 className="mono-meta text-fg">Affects</h2>
            <ul className="divide-y divide-hairline glass rounded-2xl">
              {affects.map((c) => (
                <li
                  key={`${c.cardId}-affects`}
                  className="px-4 py-3 flex items-center gap-3"
                  data-card-id={c.cardId}
                >
                  <span className="chip">AFFECTS</span>
                  <Link
                    href={`/b/${c.boardId}/c/${c.cardId}`}
                    className="flex-1 hover:text-[color:var(--accent-cyan)] truncate"
                  >
                    {c.cardTitle}
                  </Link>
                  <span className="mono-meta-sm text-fg-faint truncate max-w-[20ch]">
                    {c.boardTitle}
                  </span>
                  <span className="mono-meta-sm text-fg-faint tabular-nums">
                    {cardCode(c.cardId)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <footer className="border-t border-hairline pt-4">
        <a
          href={`/w/${workspaceId}/versions/${versionId}/release-notes`}
          target="_blank"
          rel="noreferrer"
          className="mono-meta-sm border border-hairline rounded-xl px-3 py-2 hover:border-[color:var(--accent-cyan)]/60"
        >
          EXPORT RELEASE NOTES (MARKDOWN)
        </a>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass rounded-2xl p-4 space-y-1">
      <div className="mono-meta-sm text-fg-faint">{label}</div>
      <div className="serif-display text-3xl tabular-nums">{value}</div>
    </div>
  );
}
