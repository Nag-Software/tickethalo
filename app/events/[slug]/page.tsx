import { notFound, redirect } from 'next/navigation'
import { getPublishedShowBySlug } from '@/lib/public-events'

type Props = {
  params: Promise<{ slug: string }>
}

export const dynamic = 'force-dynamic'

export default async function EventDetailPage({ params }: Props) {
  const { slug } = await params
  const show = await getPublishedShowBySlug(slug)
  if (!show) notFound()
  // Only redirect to the canonical club URL when the show actually has a club. A
  // club-less show (legacy, or its club deleted via ON DELETE SET NULL) would
  // otherwise redirect to this same /events/[slug] route forever.
  if (!show.clubSlug) notFound()
  redirect(`/${show.clubSlug}/eventer/${show.slug}`)
}