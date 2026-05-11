"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { seedRichDemoWorkspace } from "@/actions/seed";

export function SeedRichButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function go() {
    if (
      !window.confirm(
        "Create a fully-populated demo workspace (3 boards, 4 sprints, ~50 cards)? This is additive — your existing workspaces are untouched.",
      )
    )
      return;
    start(async () => {
      try {
        const { workspaceId } = await seedRichDemoWorkspace();
        toast.success("Rich demo workspace created");
        router.push(`/w/${workspaceId}/roadmap`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }
  return (
    <Button
      type="button"
      variant="outline"
      onClick={go}
      disabled={pending}
      data-testid="seed-rich-button"
      className="gap-2 normal-case tracking-normal"
    >
      <Sparkles className="size-3.5" />
      {pending ? "Seeding…" : "Seed rich demo workspace"}
    </Button>
  );
}
