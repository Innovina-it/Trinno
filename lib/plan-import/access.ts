import "server-only";

// Access to the plan-import wizard is restricted to a small allowlist. The
// feature builds entire workspaces from an uploaded plan via a paid API (and
// writes Google Docs), so it is not a general-member tool. All three entry
// points enforce this: the page 404s, and the extract route + build action
// reject, for anyone not on the list. Emails are compared case-insensitively.
export const IMPORT_PLAN_ALLOWED_EMAILS: readonly string[] = [
  "team@innovina.it",
  "paolo.pavani@innovina.it",
];

export function isImportPlanAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return IMPORT_PLAN_ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}
