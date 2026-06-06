import { channels } from "./registry";

/** True when at least one external channel can actually deliver to this user.
 *  Email is excluded until its send path is wired (today: false).
 *  Telegram counts once user_channel_links.status = 'linked'. */
export async function hasExternalDeliveryChannel(userId: string): Promise<boolean> {
  for (const c of channels) {
    if (c.id === "email") continue; // delivery not wired — see DESIGN.md §2
    if (await c.isLinked(userId)) return true;
  }
  return false;
}
