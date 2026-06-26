import type { MetadataRoute } from 'next'
import { getPublicAppUrl } from '@/lib/app-url'
import { getPublicClubs } from '@/lib/public-clubs'
import { getUpcomingPublishedShows, getPublicShowHref } from '@/lib/public-events'
import { getPublicArtists } from '@/lib/public-artists'

// Re-generate at most hourly — event/club/artist sets change slowly.
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getPublicAppUrl()

  const [clubs, shows, artists] = await Promise.all([
    getPublicClubs(),
    getUpcomingPublishedShows(),
    getPublicArtists(),
  ])

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/artists`, changeFrequency: 'weekly', priority: 0.6 },
  ]

  const clubRoutes: MetadataRoute.Sitemap = clubs
    .filter((club) => Boolean(club.slug))
    .map((club) => ({
      url: `${base}/${club.slug}`,
      changeFrequency: 'daily',
      priority: 0.8,
    }))

  const showRoutes: MetadataRoute.Sitemap = shows
    .filter((show) => Boolean(show.slug))
    .map((show) => ({
      url: `${base}${getPublicShowHref(show)}`,
      lastModified: show.date,
      changeFrequency: 'weekly',
      priority: 0.7,
    }))

  const artistRoutes: MetadataRoute.Sitemap = artists.map((artist) => ({
    url: `${base}/artists/${artist.id}`,
    changeFrequency: 'weekly',
    priority: 0.5,
  }))

  return [...staticRoutes, ...clubRoutes, ...showRoutes, ...artistRoutes]
}
