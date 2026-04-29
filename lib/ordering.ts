import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

export function positionBetween(
  prev: string | null,
  next: string | null,
): string {
  return generateKeyBetween(prev, next);
}

export function positionsBetween(
  prev: string | null,
  next: string | null,
  count: number,
): string[] {
  return generateNKeysBetween(prev, next, count);
}
