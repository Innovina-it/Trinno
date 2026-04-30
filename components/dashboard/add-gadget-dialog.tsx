"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createGadget } from "@/actions/gadgets";
import { toast } from "sonner";

type GadgetType =
  | "count"
  | "recent_activity"
  | "assigned_to_me"
  | "due_this_week"
  | "velocity"
  | "burndown"
  | "cards_by_type"
  | "markdown_note"
  | "on_roadmap";

type GadgetSize = "1x1" | "2x1" | "2x2" | "3x1" | "3x2";

const GADGET_TYPES: Array<{
  type: GadgetType;
  label: string;
  description: string;
  needsWorkspace: boolean;
  defaultSize: GadgetSize;
}> = [
  {
    type: "count",
    label: "Count",
    description: "A single big number — open cards, overdue, my assignments.",
    needsWorkspace: false,
    defaultSize: "1x1",
  },
  {
    type: "recent_activity",
    label: "Recent activity",
    description: "List of the last N activity rows.",
    needsWorkspace: false,
    defaultSize: "2x2",
  },
  {
    type: "assigned_to_me",
    label: "Assigned to me",
    description: "Cards currently assigned to you.",
    needsWorkspace: false,
    defaultSize: "2x2",
  },
  {
    type: "due_this_week",
    label: "Due this week",
    description: "Cards due in the next 7 days.",
    needsWorkspace: false,
    defaultSize: "2x2",
  },
  {
    type: "velocity",
    label: "Velocity",
    description: "Bar chart of last N completed sprints (story points).",
    needsWorkspace: true,
    defaultSize: "2x1",
  },
  {
    type: "burndown",
    label: "Burndown",
    description: "Burndown chart of the workspace's active sprint.",
    needsWorkspace: true,
    defaultSize: "3x2",
  },
  {
    type: "cards_by_type",
    label: "Cards by type",
    description: "Counts of epic / story / task / subtask / bug.",
    needsWorkspace: false,
    defaultSize: "2x1",
  },
  {
    type: "markdown_note",
    label: "Markdown note",
    description: "Static markdown text you write yourself.",
    needsWorkspace: false,
    defaultSize: "2x1",
  },
  {
    type: "on_roadmap",
    label: "On roadmap",
    description: "Counts of total / scheduled / unscheduled / overdue cards.",
    needsWorkspace: true,
    defaultSize: "2x1",
  },
];

export function AddGadgetButton({
  dashboardId,
  dashboardWorkspaceId,
  workspaces,
}: {
  dashboardId: string;
  dashboardWorkspaceId: string | null;
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<GadgetType>("count");
  const [size, setSize] = useState<GadgetSize>("1x1");
  const [workspaceId, setWorkspaceId] = useState<string>(
    dashboardWorkspaceId ?? workspaces[0]?.id ?? "",
  );
  const [what, setWhat] = useState<
    "open_cards" | "overdue" | "my_assignments" | "completed_this_week"
  >("open_cards");
  const [body, setBody] = useState("");
  const [limit, setLimit] = useState(10);
  const [n, setN] = useState(6);
  const [pending, startT] = useTransition();
  const router = useRouter();

  const meta = GADGET_TYPES.find((t) => t.type === type)!;

  function reset() {
    setType("count");
    setSize("1x1");
    setWhat("open_cards");
    setBody("");
    setLimit(10);
    setN(6);
    setWorkspaceId(dashboardWorkspaceId ?? workspaces[0]?.id ?? "");
  }

  function selectType(next: GadgetType) {
    setType(next);
    const m = GADGET_TYPES.find((t) => t.type === next)!;
    setSize(m.defaultSize);
  }

  function buildConfig(): Record<string, unknown> {
    switch (type) {
      case "count":
        return {
          what,
          workspaceId: workspaceId || null,
        };
      case "recent_activity":
        return { workspaceId: workspaceId || null, limit };
      case "assigned_to_me":
      case "due_this_week":
      case "cards_by_type":
        return { workspaceId: workspaceId || null };
      case "velocity":
        return { workspaceId, n };
      case "burndown":
        return { workspaceId };
      case "on_roadmap":
        return { workspaceId };
      case "markdown_note":
        return { body };
      default:
        return {};
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (meta.needsWorkspace && !workspaceId) {
      toast.error("Select a workspace");
      return;
    }
    startT(async () => {
      try {
        await createGadget({
          dashboardId,
          type,
          config: buildConfig(),
          size,
        });
        setOpen(false);
        reset();
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  const submitDisabled =
    pending ||
    (meta.needsWorkspace && !workspaceId) ||
    (type === "markdown_note" && !body.trim());

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="add-gadget-btn"
      >
        <Plus className="size-3.5 mr-0.5" /> Add gadget
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add gadget</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="gad-type">Type</Label>
              <select
                id="gad-type"
                value={type}
                onChange={(e) => selectType(e.target.value as GadgetType)}
                className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm"
              >
                {GADGET_TYPES.map((g) => (
                  <option key={g.type} value={g.type}>
                    {g.label}
                  </option>
                ))}
              </select>
              <p className="mono-meta-sm text-fg-faint">{meta.description}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gad-size">Size</Label>
              <select
                id="gad-size"
                value={size}
                onChange={(e) => setSize(e.target.value as GadgetSize)}
                className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm"
              >
                <option value="1x1">1×1</option>
                <option value="2x1">2×1</option>
                <option value="2x2">2×2</option>
                <option value="3x1">3×1</option>
                <option value="3x2">3×2</option>
              </select>
            </div>

            {meta.needsWorkspace && (
              <div className="space-y-1.5">
                <Label htmlFor="gad-ws">Workspace</Label>
                <select
                  id="gad-ws"
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm"
                  required
                >
                  {workspaces.length === 0 && <option value="">—</option>}
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!meta.needsWorkspace && type !== "markdown_note" && (
              <div className="space-y-1.5">
                <Label htmlFor="gad-ws-opt">Workspace (optional)</Label>
                <select
                  id="gad-ws-opt"
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm"
                >
                  <option value="">All my workspaces</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {type === "count" && (
              <div className="space-y-1.5">
                <Label htmlFor="gad-what">What to count</Label>
                <select
                  id="gad-what"
                  value={what}
                  onChange={(e) =>
                    setWhat(
                      e.target.value as
                        | "open_cards"
                        | "overdue"
                        | "my_assignments"
                        | "completed_this_week",
                    )
                  }
                  className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm"
                >
                  <option value="open_cards">Open cards</option>
                  <option value="overdue">Overdue</option>
                  <option value="my_assignments">My assignments</option>
                  <option value="completed_this_week">
                    Completed this week
                  </option>
                </select>
              </div>
            )}

            {type === "recent_activity" && (
              <div className="space-y-1.5">
                <Label htmlFor="gad-limit">Limit</Label>
                <Input
                  id="gad-limit"
                  type="number"
                  min={1}
                  max={50}
                  value={limit}
                  onChange={(e) =>
                    setLimit(Math.max(1, Math.min(50, Number(e.target.value))))
                  }
                />
              </div>
            )}

            {type === "velocity" && (
              <div className="space-y-1.5">
                <Label htmlFor="gad-n">Number of sprints</Label>
                <Input
                  id="gad-n"
                  type="number"
                  min={1}
                  max={20}
                  value={n}
                  onChange={(e) =>
                    setN(Math.max(1, Math.min(20, Number(e.target.value))))
                  }
                />
              </div>
            )}

            {type === "markdown_note" && (
              <div className="space-y-1.5">
                <Label htmlFor="gad-body">Body</Label>
                <textarea
                  id="gad-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm font-mono"
                  placeholder="# Heading&#10;**bold**, *italic*, [links](https://example.com)"
                />
              </div>
            )}

            <DialogFooter>
              <Button type="submit" disabled={submitDisabled}>
                {pending ? "Adding…" : "Add gadget"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
