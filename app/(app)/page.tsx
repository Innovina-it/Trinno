import { redirect } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listWorkspaces } from "@/lib/queries/workspaces";

export default async function Home() {
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await listWorkspaces(token);
  if (ws.length === 0) {
    return (
      <main className="space-y-4">
        <h1 className="text-2xl font-semibold">No workspaces yet</h1>
        <p className="text-sm text-muted-foreground">
          Use the workspace switcher in the top nav to create one.
        </p>
      </main>
    );
  }
  redirect(`/w/${ws[0].id}`);
}
