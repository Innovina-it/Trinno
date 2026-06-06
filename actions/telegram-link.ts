"use server";
import { revalidatePath } from "next/cache";
import { getSessionToken, requireUser } from "@/lib/auth";
import { telegramLinker } from "@/lib/notifications/channels/telegram/linker";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

// Mint a one-time Telegram link token for the signed-in user and return the
// t.me deep-link the settings UI shows (button/QR). The plaintext token lives
// only in the returned URL — never persisted (see linker).
export async function startTelegramLink(): Promise<{
  url: string;
  expiresAt: string;
}> {
  await requireUser();
  const token = (await getSessionToken())!;
  const userId = decodeSub(token);
  return telegramLinker.startLink(userId);
}

// Revoke the signed-in user's Telegram link.
export async function unlinkTelegram(): Promise<void> {
  await requireUser();
  const token = (await getSessionToken())!;
  const userId = decodeSub(token);
  await telegramLinker.unlink(userId);
  revalidatePath("/settings/notifications");
}
