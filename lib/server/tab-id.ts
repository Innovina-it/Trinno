import { headers } from "next/headers";
import { TAB_ID_HEADER } from "@/lib/auth/tab-id";

export async function getServerTabId(): Promise<string | undefined> {
  try {
    const h = await headers();
    const value = h.get(TAB_ID_HEADER);
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}
