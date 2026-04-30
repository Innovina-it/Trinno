import { listVersions } from "@/lib/queries/versions";
import { getSessionToken } from "@/lib/auth";
import { CreateVersionDialog } from "./create-version-dialog";
import { VersionStateControl } from "./version-state-control";

export async function VersionsPanel({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const token = (await getSessionToken())!;
  const versions = await listVersions(token, workspaceId);

  return (
    <div className="space-y-3" data-testid="versions-panel">
      <div className="flex items-center justify-between">
        <h3 className="mono-meta text-fg">Versions</h3>
        <CreateVersionDialog workspaceId={workspaceId} />
      </div>
      <ul className="divide-y divide-hairline glass rounded-2xl">
        {versions.map((v) => (
          <li
            key={v.id}
            className="px-4 py-3 flex items-center gap-3"
            data-version-id={v.id}
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{v.name}</div>
              {v.semver && (
                <div className="mono-meta-sm text-fg-faint">{v.semver}</div>
              )}
            </div>
            <span className="mono-meta-sm text-fg-faint tabular-nums">
              {v.releaseDate
                ? new Date(v.releaseDate).toISOString().slice(0, 10)
                : "—"}
            </span>
            <VersionStateControl id={v.id} state={v.state} />
          </li>
        ))}
        {versions.length === 0 && (
          <li className="px-4 py-4 text-sm text-fg-faint italic">
            No versions yet.
          </li>
        )}
      </ul>
    </div>
  );
}
