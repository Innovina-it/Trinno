import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace, listMembers } from "@/lib/queries/workspaces";
import { WorkspaceSettingsForm } from "@/components/workspace/workspace-settings-form";
import { MemberList } from "@/components/workspace/member-list";
import { InviteMemberForm } from "@/components/workspace/invite-member-form";
import { Separator } from "@/components/ui/separator";

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
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-10">
      <h1 className="text-2xl font-semibold">{ws.name} — Settings</h1>

      <section className="space-y-4">
        <h2 className="font-medium">Workspace</h2>
        <WorkspaceSettingsForm workspace={{ id: ws.id, name: ws.name }} />
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="font-medium">Members</h2>
        <InviteMemberForm workspaceId={workspaceId} />
        <MemberList workspaceId={workspaceId} members={members} />
      </section>
    </div>
  );
}
