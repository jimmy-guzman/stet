/**
 * Canonical site origin. On Vercel this resolves to the production domain on every deployment,
 * including previews, so metadata and the install command always point at production rather than a
 * preview URL. The fallback is only used for local dev; the production domain is whatever is
 * attached in Vercel.
 */
export const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "https://stet.jimmy.codes";
