import { dbAsUser } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";

export default async function Home() {
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await dbAsUser(token, async (tx) =>
    tx.select({ id: workspaces.id, name: workspaces.name }).from(workspaces)
  );

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-semibold">Your workspaces</h1>
      <ul className="space-y-2">
        {ws.map(w => (
          <li key={w.id} className="rounded border p-3">{w.name}</li>
        ))}
      </ul>
      {ws.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No workspaces yet (UI to create them ships in plan #2).
        </p>
      )}
    </main>
  );
}
