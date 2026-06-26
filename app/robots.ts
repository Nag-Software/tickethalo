import type { MetadataRoute } from 'next'
import { getPublicAppUrl } from '@/lib/app-url'

export default function robots(): MetadataRoute.Robots {
  const base = getPublicAppUrl()

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Authenticated apps, internal APIs and token/PII-bearing flows have no business
      // being crawled. /signup is intentionally left crawlable — it's a conversion page.
      disallow: ['/admin-app', '/artist-app', '/superadmin', '/api', '/booking-offer', '/checkout', '/login'],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
