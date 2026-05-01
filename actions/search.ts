"use server";
import { searchCards, searchCardsForLink } from "@/lib/queries/search";
import { getSessionToken, requireUser } from "@/lib/auth";

export async function search(query: string) {
  await requireUser();
  const token = (await getSessionToken())!;
  return searchCards(token, query);
}

// Plan #16b-γ-D (#38) — cross-board card link picker source.
export async function searchCardsForLinkAction(query: string) {
  await requireUser();
  const token = (await getSessionToken())!;
  return searchCardsForLink(token, query);
}
