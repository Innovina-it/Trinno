import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/queries/workspaces";
import { listVersions } from "@/lib/queries/versions";
import { CreateVersionDialog } from "@/components/versions/create-version-dialog";
import { VersionStateControl } from "@/components/versions/version-state-control";
import { formatDate } from "@/lib/format-date";

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
            <li
              key={v.id}
              className="glass rounded-2xl p-5 transition-shadow hover:shadow-[0_8px_30px_-10px_rgb(0_229_255/0.30)] space-y-2"
              data-version-id={v.id}
            >
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/w/${workspaceId}/versions/${v.id}`}
                  className="serif-display text-2xl hover:text-[color:var(--accent-cyan)] truncate"
                >
                  {v.name}
                </Link>
                <VersionStateControl id={v.id} state={v.state} />
              </div>
              {v.semver && (
                <div className="mono-meta-sm text-fg-muted">{v.semver}</div>
              )}
              <div className="mono-meta-sm text-fg-faint tabular-nums">
                {v.releaseDate ? formatDate(v.releaseDate) : "no date"}
              </div>
              {v.description && (
                <p className="text-sm text-fg-muted line-clamp-3">
                  {v.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
