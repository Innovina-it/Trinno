"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  startTelegramLink,
  unlinkTelegram,
} from "@/actions/telegram-link";

type LinkStatus = "linked" | "pending" | "none";

// Telegram connect / disconnect control for the CHANNELS section.
//
// none/pending -> [Connect] mints a one-time link token (startTelegramLink)
// and opens the t.me deep-link in a new tab; after opening we show a
// "waiting for confirmation…" hint (the webhook flips pending -> linked).
//
// linked -> "@handle · Connected [Disconnect]" when we captured the Telegram
// @username at link time (handle prop), else plain "Connected [Disconnect]".
export function TelegramConnect({
  status,
  handle,
}: {
  status: LinkStatus;
  handle?: string | null;
}) {
  const [waiting, setWaiting] = useState(status === "pending");
  const [pending, start] = useTransition();

  function onConnect() {
    start(async () => {
      try {
        const { url } = await startTelegramLink();
        window.open(url, "_blank", "noopener,noreferrer");
        setWaiting(true);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function onDisconnect() {
    start(async () => {
      try {
        await unlinkTelegram();
        setWaiting(false);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  if (status === "linked") {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-fg">
          {handle ? `@${handle} · Connected` : "Connected"}
        </span>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={onDisconnect}
        >
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={onConnect}
      >
        Connect
      </Button>
      {waiting ? (
        <span className="mono-meta-sm text-fg-faint">
          Waiting for confirmation…
        </span>
      ) : null}
    </div>
  );
}
