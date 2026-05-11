"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useBoardStore } from "@/stores/board-store";
import {
  registerAttachment,
  deleteAttachment,
  createAttachmentSignedUrl,
} from "@/actions/attachments";
import { toast } from "sonner";
import { Download, ExternalLink, Paperclip, X } from "lucide-react";
import { undoBus } from "@/lib/undo-bus";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentsSection({ cardId }: { cardId: string }) {
  const allAttachments = useBoardStore((s) => s.attachments);
  const attachments = useMemo(
    () => allAttachments.filter((a) => a.cardId === cardId),
    [allAttachments, cardId],
  );
  const addAttachment = useBoardStore((s) => s.addAttachment);
  const removeAttachment = useBoardStore((s) => s.removeAttachment);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, filename: file.name }),
      });
      if (!res.ok) throw new Error(`upload init ${res.status}`);
      const { path, signedUrl } = await res.json();
      const put = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });
      if (!put.ok) throw new Error(`upload PUT ${put.status}`);
      const row = await registerAttachment({
        cardId,
        storagePath: path,
        filename: file.name,
        mime: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      addAttachment(row);
      toast.success("Uploaded");
      undoBus.push({
        message: "Attachment uploaded",
        undo: async () => {
          removeAttachment(row.id);
          try {
            await deleteAttachment({ id: row.id });
          } catch (err) {
            addAttachment(row);
            toast.error("Undo failed: " + (err as Error).message);
          }
        },
      });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function remove(id: string) {
    const snapshot = attachments.find((a) => a.id === id);
    if (snapshot) removeAttachment(id);
    start(async () => {
      try {
        await deleteAttachment({ id });
      } catch (err) {
        if (snapshot) addAttachment(snapshot);
        toast.error((err as Error).message);
      }
    });
  }

  async function openAttachment(id: string) {
    setOpeningId(id);
    try {
      const { url } = await createAttachmentSignedUrl({ id });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOpeningId(null);
    }
  }

  async function downloadAttachment(id: string) {
    setDownloadingId(id);
    try {
      const { url } = await createAttachmentSignedUrl({ id, download: true });
      window.location.assign(url);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <section className="space-y-3" data-testid="attachments-section">
      <div className="flex items-baseline justify-between border-b border-hairline pb-1">
        <h3 className="mono-meta text-fg-muted">Attachments</h3>
      </div>
      <ul className="space-y-1">
        {attachments.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-2 border-b border-hairline pb-1.5 text-sm"
            data-attachment-id={a.id}
          >
            <Paperclip className="size-3.5 text-fg-faint" />
            <span className="flex-1 truncate text-fg">{a.filename}</span>
            <span className="mono-meta-sm text-fg-muted tabular-nums">
              {formatSize(a.sizeBytes)}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={pending || openingId === a.id || downloadingId === a.id}
              onClick={() => openAttachment(a.id)}
              aria-label={`Open ${a.filename}`}
              title="Open"
            >
              <ExternalLink className="size-3" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={pending || openingId === a.id || downloadingId === a.id}
              onClick={() => downloadAttachment(a.id)}
              aria-label={`Download ${a.filename}`}
              title="Download"
            >
              <Download className="size-3" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={pending}
              onClick={() => remove(a.id)}
            >
              <X className="size-3" />
            </Button>
          </li>
        ))}
      </ul>
      <input ref={inputRef} type="file" hidden onChange={onFile} />
      <Button
        size="sm"
        variant="outline"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="mr-1 size-3.5" />{" "}
        {uploading ? "Uploading…" : "Add attachment"}
      </Button>
    </section>
  );
}
