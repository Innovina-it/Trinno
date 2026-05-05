"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  Calendar,
  CalendarRange,
  FileText,
  Hash,
  LineChart,
  Map,
  Plus,
  PieChart,
  User,
} from "lucide-react";
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
  Icon: typeof Hash;
}> = [
  { type: "count", label: "Count", description: "A single big number.", needsWorkspace: false, defaultSize: "1x1", Icon: Hash },
  { type: "recent_activity", label: "Recent activity", description: "Last N activity rows.", needsWorkspace: false, defaultSize: "2x2", Icon: Activity },
  { type: "assigned_to_me", label: "Assigned to me", description: "Cards assigned to you.", needsWorkspace: false, defaultSize: "2x2", Icon: User },
  { type: "due_this_week", label: "Due this week", description: "Cards due in 7 days.", needsWorkspace: false, defaultSize: "2x2", Icon: Calendar },
  { type: "velocity", label: "Velocity", description: "Last N completed sprints.", needsWorkspace: true, defaultSize: "2x1", Icon: BarChart3 },
  { type: "burndown", label: "Burndown", description: "Active sprint burndown.", needsWorkspace: true, defaultSize: "3x2", Icon: LineChart },
  { type: "cards_by_type", label: "Cards by type", description: "Counts per type.", needsWorkspace: false, defaultSize: "2x1", Icon: PieChart },
  { type: "on_roadmap", label: "On roadmap", description: "Total / scheduled / overdue.", needsWorkspace: true, defaultSize: "2x1", Icon: Map },
  { type: "markdown_note", label: "Note", description: "Static markdown.", needsWorkspace: false, defaultSize: "2x1", Icon: FileText },
];

const SIZES: Array<{ id: GadgetSize; cols: number; rows: number }> = [
  { id: "1x1", cols: 1, rows: 1 },
  { id: "2x1", cols: 2, rows: 1 },
  { id: "2x2", cols: 2, rows: 2 },
  { id: "3x1", cols: 3, rows: 1 },
  { id: "3x2", cols: 3, rows: 2 },
];

const SELECT_CLS =
  "w-full h-10 rounded-md border border-hairline bg-[color:var(--surface)] px-3 text-sm text-fg outline-none hover:border-hairline-hi focus-visible:border-[color:var(--accent-cyan)]/60";

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
        return { what, workspaceId: workspaceId || null };
      case "recent_activity":
        return { workspaceId: workspaceId || null, limit };
      case "assigned_to_me":
      case "due_this_week":
      case "cards_by_type":
        return { workspaceId: workspaceId || null };
      case "velocity":
        return { workspaceId, n };
      case "burndown":
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
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add gadget</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-5">
            {/* Type — visual tile picker. */}
            <div className="space-y-2">
              <Label>Type</Label>
              <div
                role="radiogroup"
                aria-label="Gadget type"
                className="grid grid-cols-3 gap-1.5"
              >
                {GADGET_TYPES.map((g) => {
                  const selected = type === g.type;
                  return (
                    <button
                      key={g.type}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => selectType(g.type)}
                      className={`flex flex-col items-start gap-1 rounded-md border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
                        selected
                          ? "border-fg/40 bg-fg/10 text-fg"
                          : "border-hairline bg-[color:var(--surface)] text-fg-muted hover:text-fg hover:border-hairline-hi"
                      }`}
                    >
                      <g.Icon className="size-3.5" aria-hidden />
                      <span className="text-sm font-medium text-fg">
                        {g.label}
                      </span>
                      <span className="mono-meta-sm text-fg-faint leading-tight">
                        {g.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Size — visual ratio picker. */}
            <div className="space-y-2">
              <Label>Size</Label>
              <div
                role="radiogroup"
                aria-label="Gadget size"
                className="flex items-end gap-2"
              >
                {SIZES.map((s) => {
                  const selected = size === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      title={s.id}
                      onClick={() => setSize(s.id)}
                      className={`inline-flex flex-col items-center gap-1.5 p-2 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
                        selected
                          ? "bg-fg/10"
                          : "hover:bg-[color:var(--surface)]"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`block rounded-sm border ${
                          selected
                            ? "border-fg/60 bg-fg/30"
                            : "border-hairline-hi bg-[color:var(--surface-strong)]"
                        }`}
                        style={{
                          width: `${s.cols * 14}px`,
                          height: `${s.rows * 14}px`,
                        }}
                      />
                      <span
                        className={`mono-meta-sm tabular-nums ${
                          selected ? "text-fg" : "text-fg-faint"
                        }`}
                      >
                        {s.id}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {meta.needsWorkspace && (
              <div className="space-y-1.5">
                <Label htmlFor="gad-ws">Workspace</Label>
                <select
                  id="gad-ws"
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  className={SELECT_CLS}
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
                  className={SELECT_CLS}
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
                  className={SELECT_CLS}
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
                  className="w-full rounded-md border border-hairline bg-[color:var(--surface)] px-3 py-2 text-sm font-mono text-fg outline-none hover:border-hairline-hi focus-visible:border-[color:var(--accent-cyan)]/60"
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
