"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Link as LinkIcon, Check } from "lucide-react";
import { toast } from "sonner";

export function CopyPermalinkButton() {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Permalink copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy permalink");
    }
  }

  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={onCopy}
      data-testid="sprint-report-permalink"
      aria-label="Copy permalink"
    >
      {copied ? (
        <Check className="size-3 mr-1" />
      ) : (
        <LinkIcon className="size-3 mr-1" />
      )}
      {copied ? "COPIED" : "PERMALINK"}
    </Button>
  );
}
