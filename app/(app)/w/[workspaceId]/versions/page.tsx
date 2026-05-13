import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/queries/workspaces";
import { listVersions } from "@/lib/queries/versions";
import { CreateVersionDialog } from "@/components/versions/create-version-dialog";
import { formatDate } from "@/lib/format-date";

const STATE_BADGE: Record<string, string> = {
  unreleased: "border-fg/40 text-fg/80",
  released: "border-[color:var(--accent-cyan)] text-[color:var(--accent-cyan)]",
  archived: "border-fg/20 text-fg/40",
};

export default async function VersionsListPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const versions = await listVersions(token, workspaceId);

  return (
    <div className="mx-auto max-w-6xl px-3 sm:px-4 md:px-6 py-6 md:py-10 space-y-10">
      <header className="space-y-3 border-b border-hairline pb-6">
        <span className="chip">{ws.name.toUpperCase()} / VERSIONS</span>
        <h1 className="serif-display text-5xl">Releases</h1>
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/w/${workspaceId}`}
            className="mono-meta-sm text-fg-muted hover:text-fg"
          >
            ← Back to workspace
          </Link>
          <CreateVersionDialog workspaceId={workspaceId} />
        </div>
      </header>

      {versions.length === 0 ? (
        <p className="font-serif italic text-fg-faint">
          No versions yet. Create your first release above.
        </p>
      ) : (
        <ul
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="versions-grid"
        >
          {versions.map((v) => (
            <li key={v.id}>
              <Link
                href={`/w/${workspaceId}/versions/${v.id}`}
                className="block glass rounded-2xl p-5 transition-shadow hover:shadow-[0_8px_30px_-10px_rgb(0_229_255/0.30)]"
                data-version-id={v.id}
              >
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <span className="serif-display text-2xl">{v.name}</span>
                  <span
                    className={`mono-meta-sm border px-2 py-0.5 ${
                      STATE_BADGE[v.state] ?? ""
                    }`}
                  >
                    {v.state.toUpperCase()}
                  </span>
                </div>
                {v.semver && (
                  <div className="mono-meta-sm text-fg-muted mb-1">
                    {v.semver}
                  </div>
                )}
                <div className="mono-meta-sm text-fg-faint tabular-nums">
                  {v.releaseDate ? formatDate(v.releaseDate) : "no date"}
                </div>
                {v.description && (
                  <p className="text-sm text-fg-muted mt-2 line-clamp-3">
                    {v.description}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
