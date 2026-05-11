import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace, listMembers } from "@/lib/queries/workspaces";
import { WorkspaceSettingsForm } from "@/components/workspace/workspace-settings-form";
import { MemberList } from "@/components/workspace/member-list";
import { InviteMemberForm } from "@/components/workspace/invite-member-form";
import { VersionsPanel } from "@/components/versions/versions-panel";

export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const members = await listMembers(token, workspaceId);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-3 sm:px-4 md:px-6 py-6 md:py-8">
      <header className="space-y-2 border-b border-hairline pb-4">
        <div className="flex items-center gap-1.5 mono-meta-sm text-fg-faint">
          <Link href={`/w/${workspaceId}`} className="hover:text-fg">
            WORKSPACE
          </Link>
          <span>/</span>
          <span className="text-fg">SETTINGS</span>
        </div>
        <h1 className="font-sans text-2xl font-bold tracking-tight text-fg truncate">
          {ws.name}
        </h1>
      </header>

      <section className="space-y-3">
        <h2 className="mono-meta-sm text-fg-faint">WORKSPACE</h2>
        <div className="rounded-xl border border-hairline bg-[color:var(--surface)] p-4">
          <WorkspaceSettingsForm
            workspace={{
              id: ws.id,
              name: ws.name,
              autoAssignCreator: ws.autoAssignCreator,
            }}
          />
        </div>
      </section>

      <section id="members" className="space-y-3 scroll-mt-20">
        <h2 className="mono-meta-sm text-fg-faint">MEMBERS</h2>
        <div className="rounded-xl border border-hairline bg-[color:var(--surface)] p-4 space-y-4">
          <InviteMemberForm workspaceId={workspaceId} />
          <MemberList workspaceId={workspaceId} members={members} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="mono-meta-sm text-fg-faint">VERSIONS</h2>
        <div className="rounded-xl border border-hairline bg-[color:var(--surface)] p-4">
          <VersionsPanel workspaceId={workspaceId} />
        </div>
      </section>
    </div>
  );
}
