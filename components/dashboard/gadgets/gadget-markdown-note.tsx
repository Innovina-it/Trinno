import { MarkdownView } from "@/components/markdown";

export function GadgetMarkdownNote({ body }: { body: string }) {
  return (
    <MarkdownView
      body={body}
      className="overflow-y-auto max-h-full"
      emptyText="Empty note."
    />
  );
}
