"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Image as ImageIcon, Palette, X } from "lucide-react";
import { toast } from "sonner";
import { updateCard } from "@/actions/cards";
import { useBoardStore } from "@/stores/board-store";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

export type CoverKind = "none" | "color" | "image";

// Module-level signed-URL cache so the same path doesn't re-sign on every
// re-render. Signed URLs from `card-attachments` are valid for 1h by
// default; we cache for 50min and re-mint past that.
const SIGNED_URL_CACHE = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_TTL_MS = 50 * 60 * 1000;

async function resolveSignedUrl(path: string): Promise<string> {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const cached = SIGNED_URL_CACHE.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const supa = createSupabaseBrowser();
  const { data, error } = await supa.storage
    .from("card-attachments")
    .createSignedUrl(path, 60 * 60);
  if (error || !data) throw error ?? new Error("sign failed");
  SIGNED_URL_CACHE.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_TTL_MS,
  });
  return data.signedUrl;
}

// Plan #16b-γ-C (#2) — palette of 6 monochrome shades. The cover stripe
// renders this as a 32px band atop the tile; we use rgba so the bg
// composites against the tile glass nicely.
export const COVER_PALETTE: { id: string; value: string; label: string }[] = [
  { id: "stone", value: "rgba(168,162,158,0.75)", label: "Stone" },
  { id: "sand", value: "rgba(214,200,179,0.65)", label: "Sand" },
  { id: "ash", value: "rgba(120,113,108,0.85)", label: "Ash" },
  { id: "fog", value: "rgba(231,229,228,0.55)", label: "Fog" },
  { id: "ink", value: "rgba(41,37,36,0.95)", label: "Ink" },
  { id: "bone", value: "rgba(245,245,244,0.45)", label: "Bone" },
];

/**
 * Render-only helper for the tile. Color → 32px stripe. Image → 100px
 * background-image header. None → nothing.
 *
 * Image resolution: signed URLs minted client-side from the
 * `card-attachments` bucket. While the URL resolves we render a neutral
 * placeholder so the tile height stays stable.
 */
export function CardCover({
  coverKind,
  coverValue,
}: {
  coverKind: CoverKind;
  coverValue: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (coverKind !== "image" || !coverValue) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    resolveSignedUrl(coverValue)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [coverKind, coverValue]);

  if (coverKind === "color" && coverValue) {
    return (
      <div
        data-testid="card-cover-color"
        aria-hidden
        className="h-8 w-full"
        style={{ background: coverValue }}
      />
    );
  }
  if (coverKind === "image" && coverValue) {
    return (
      <div
        data-testid="card-cover-image"
        aria-hidden
        className="h-[100px] w-full bg-cover bg-center bg-fg/5"
        style={url ? { backgroundImage: `url(${url})` } : undefined}
      />
    );
  }
  return null;
}

export function CoverPicker({
  cardId,
  coverKind,
  coverValue,
}: {
  cardId: string;
  coverKind: CoverKind;
  coverValue: string | null;
}) {
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState(false);

  function setCover(nextKind: CoverKind, nextValue: string | null) {
    const prev = { coverKind, coverValue };
    updateCardLocal(cardId, {
      coverKind: nextKind,
      coverValue: nextValue,
    });
    start(async () => {
      try {
        await updateCard({
          id: cardId,
          coverKind: nextKind,
          coverValue: nextValue,
        });
      } catch (err) {
        updateCardLocal(cardId, prev);
        toast.error((err as Error).message);
      }
    });
  }

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
      setCover("image", path);
      toast.success("Cover updated");
      setOpen(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="space-y-2" data-testid="cover-picker">
      <div className="flex items-baseline justify-between border-b border-hairline pb-1.5">
        <div className="flex items-center gap-2">
          <span aria-hidden className="block w-0.5 h-4 accent-bar-cyan rounded-full" />
          <h3 className="mono-meta text-fg">Cover</h3>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mono-meta-sm text-fg-faint hover:text-fg"
          data-testid="cover-toggle"
        >
          {open ? "CLOSE" : coverKind === "none" ? "ADD" : "EDIT"}
        </button>
      </div>

      {/* Preview */}
      <div className="rounded-lg border border-hairline overflow-hidden">
        <CardCover coverKind={coverKind} coverValue={coverValue} />
        {coverKind === "none" && (
          <div className="px-3 py-2 mono-meta-sm text-fg-faint">
            NO COVER
          </div>
        )}
      </div>

      {open && (
        <div className="space-y-3 rounded-lg border border-hairline p-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2 mono-meta-sm text-fg-muted">
              <Palette className="size-3" />
              COLOR
            </div>
            <div className="flex flex-wrap gap-2">
              {COVER_PALETTE.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid="cover-color-swatch"
                  data-cover-color-id={c.id}
                  onClick={() => setCover("color", c.value)}
                  disabled={pending}
                  aria-label={`Cover ${c.label}`}
                  title={c.label}
                  className={`h-8 w-12 rounded border border-hairline transition-all hover:scale-105 ${
                    coverKind === "color" && coverValue === c.value
                      ? "ring-2 ring-fg/60"
                      : ""
                  }`}
                  style={{ background: c.value }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 mono-meta-sm text-fg-muted">
              <ImageIcon className="size-3" />
              IMAGE
            </div>
            <input ref={inputRef} type="file" accept="image/*" hidden onChange={onFile} />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading || pending}
              data-testid="cover-upload"
              className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)]"
            >
              <ImageIcon className="size-3" />
              {uploading ? "UPLOADING…" : "UPLOAD IMAGE"}
            </button>
          </div>

          {coverKind !== "none" && (
            <button
              type="button"
              onClick={() => setCover("none", null)}
              disabled={pending}
              data-testid="cover-clear"
              className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] text-fg-muted hover:text-fg"
            >
              <X className="size-3" />
              CLEAR COVER
            </button>
          )}
        </div>
      )}
    </section>
  );
}
