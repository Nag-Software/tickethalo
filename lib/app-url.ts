const PRODUCTION_APP_URL = 'https://humorevents.vercel.app'

/** Base URL for public-facing links in emails, checkout, etc. (no trailing slash). */
export function getPublicAppUrl() {
  const fromEnv =
    process.env.APP_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.NEXT_PUBLIC_SITE_URL

  if (fromEnv) return fromEnv.replace(/\/$/, '')

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`
  }

  if (process.env.NODE_ENV === 'production') return PRODUCTION_APP_URL

  return 'http://localhost:3000'
}
