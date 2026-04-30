import { listComponents } from "@/lib/queries/components";
import { getSessionToken } from "@/lib/auth";
import { AddComponentForm } from "./add-component-form";
import { ComponentRow } from "./component-row";

export async function ComponentsPanel({ boardId }: { boardId: string }) {
  const token = (await getSessionToken())!;
  const components = await listComponents(token, boardId);

  return (
    <div className="space-y-3" data-testid="components-panel">
      <div className="flex items-center justify-between">
        <h3 className="mono-meta text-fg">Components</h3>
      </div>
      <ul className="divide-y divide-hairline glass rounded-2xl">
        {components.map((c) => (
          <ComponentRow
            key={c.id}
            id={c.id}
            name={c.name}
          />
        ))}
        {components.length === 0 && (
          <li className="px-4 py-4 text-sm text-fg-faint italic">
            No components yet.
          </li>
        )}
      </ul>
      <AddComponentForm boardId={boardId} />
    </div>
  );
}
