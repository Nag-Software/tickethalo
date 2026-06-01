import { notFound, redirect } from 'next/navigation'
import { getPublicShowHref, getPublishedShowBySlug } from '@/lib/public-events'

type Props = {
  params: Promise<{ slug: string }>
}

export const dynamic = 'force-dynamic'

export default async function EventDetailPage({ params }: Props) {
  const { slug } = await params
  const show = await getPublishedShowBySlug(slug)
  if (!show) notFound()
  redirect(getPublicShowHref(show))
}