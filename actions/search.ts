"use server";
import { searchCards } from "@/lib/queries/search";
import { getSessionToken, requireUser } from "@/lib/auth";

export async function search(query: string) {
  await requireUser();
  const token = (await getSessionToken())!;
  return searchCards(token, query);
}
