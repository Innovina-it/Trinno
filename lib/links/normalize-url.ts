// Normalises a user-entered link: trims, prepends https:// when no scheme,
// and validates it parses as an absolute http(s) URL.
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("URL is empty");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("URL is not valid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must be http or https");
  }
  // Reject URLs with an empty or invalid hostname (e.g. "ht!tp://%%%" becomes "https://ht!tp//%25%25%25").
  // A valid hostname must contain at least one dot or be a recognised localhost/TLD.
  // Simplest guard: hostname must not be empty and must not contain characters
  // that are illegal in a DNS label even after punycode encoding.
  if (!parsed.hostname || /[^a-z0-9.\-[\]:]/i.test(parsed.hostname)) {
    throw new Error("URL is not valid");
  }
  // new URL() always adds a trailing slash for bare origins (e.g. "https://a.test" → "https://a.test/").
  // Strip that phantom slash when the original input had no explicit path.
  const result = parsed.toString();
  const hadExplicitTrailingSlash = withScheme.endsWith("/");
  const isOnlySlashPath = parsed.pathname === "/" && !hadExplicitTrailingSlash;
  return isOnlySlashPath ? result.replace(/\/$/, "") : result;
}
