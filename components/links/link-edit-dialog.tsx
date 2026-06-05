"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LINK_COLORS, DEFAULT_LINK_COLOR } from "@/lib/links/colors";

export function LinkEditDialog({
  open,
  onOpenChange,
  scope,
  initialUrl,
  initialColor,
  onSave,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  scope: "card" | "workspace";
  initialUrl: string;
  initialColor?: string;
  onSave: (v: { url: string; color: string }) => Promise<void> | void;
  onRemove?: () => Promise<void> | void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [color, setColor] = useState(initialColor || DEFAULT_LINK_COLOR);
  const [busy, setBusy] = useState(false);
  // Two-step confirm for the destructive Remove action. Inline (not a nested
  // AlertDialog) to mirror the repo's in-dialog confirm convention and dodge
  // modal-in-modal focus-trap issues.
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
      setColor(initialColor || DEFAULT_LINK_COLOR);
      setConfirmingRemove(false);
    }
  }, [open, initialUrl, initialColor]);

  const dirty = useMemo(
    () => url.trim() !== initialUrl.trim() || (scope === "card" && color !== (initialColor || DEFAULT_LINK_COLOR)),
    [url, color, initialUrl, initialColor, scope],
  );
  const hadLink = initialUrl.trim().length > 0;

  async function save() {
    setBusy(true);
    try { await onSave({ url: url.trim(), color }); onOpenChange(false); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!onRemove) return;
    setBusy(true);
    try { await onRemove(); onOpenChange(false); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="link-edit-dialog">
        <DialogHeader>
          <DialogTitle>{hadLink ? "Edit link" : "Add link"}</DialogTitle>
        </DialogHeader>

        <label className="block text-xs text-fg-faint mb-1">URL</label>
        <textarea
          autoFocus
          rows={3}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          data-testid="link-url-input"
          className="w-full resize-y min-h-[4.5rem] rounded-md border border-[color:var(--hairline)] bg-[color:var(--surface)] p-2 text-sm break-all outline-none focus-visible:border-[color:var(--accent-cyan)]/60"
        />

        {scope === "card" && (
          <div className="mt-3">
            <div className="text-xs text-fg-faint mb-1">Color</div>
            <div className="flex items-center gap-2">
              {LINK_COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => setColor(c.hex)}
                  data-testid={`link-color-${c.key}`}
                  style={{ background: c.hex }}
                  className={`size-6 rotate-45 rounded-[2px] ${color === c.hex ? "ring-2 ring-fg ring-offset-1 ring-offset-[color:var(--surface)]" : ""}`}
                />
              ))}
              <input
                type="color"
                aria-label="Custom color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                data-testid="link-color-custom"
                className="size-6 cursor-pointer rounded border border-[color:var(--hairline)] bg-transparent p-0"
              />
            </div>
          </div>
        )}

        <DialogFooter className="mt-4 flex items-center justify-between gap-2">
          {confirmingRemove ? (
            <>
              <span
                className="mono-meta-sm text-fg-muted"
                data-testid="link-remove-confirm-prompt"
              >
                Remove this link?
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmingRemove(false)}
                  disabled={busy}
                  data-testid="link-remove-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  data-testid="link-remove-confirm"
                  className="text-red-400 hover:text-red-300"
                >
                  Remove
                </Button>
              </div>
            </>
          ) : (
            <>
              {hadLink && onRemove ? (
                <Button variant="ghost" onClick={() => setConfirmingRemove(true)} disabled={busy}
                  data-testid="link-remove" className="text-red-400 hover:text-red-300">
                  Remove
                </Button>
              ) : <span />}
              <Button
                onClick={() => (dirty ? save() : onOpenChange(false))}
                disabled={busy || (dirty && url.trim().length === 0)}
                data-testid="link-save"
              >
                {dirty ? "Save" : "Close"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
