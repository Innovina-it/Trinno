import type { MetadataRoute } from "next";

// Only production may be indexed. Preview / pre-prod deploys are noindex so
// pre-release URLs never surface in search. VERCEL_ENV is "production" only on
// the prod deploy; "preview" on branch/PR deploys; undefined locally.
export default function robots(): MetadataRoute.Robots {
  const isProd = process.env.VERCEL_ENV === "production";
  return {
    rules: { userAgent: "*", ...(isProd ? { allow: "/" } : { disallow: "/" }) },
  };
}
