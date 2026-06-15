import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestPathname } from '@/lib/request-pathname'
import type { Artist } from '@/types/database'

export const MIN_BOOKABLE_SCORE = 6

export function normalizeArtistStatus(status: string | null | undefined) {
  return String(status ?? '').trim().toLowerCase()
}

export function isArtistGloballyApproved(artist: Pick<Artist, 'status' | 'is_flagged'>) {
  if (artist.is_flagged) return false
  return normalizeArtistStatus(artist.status) === 'approved'
}

export function isArtistBookable(artist: Pick<Artist, 'status' | 'is_flagged' | 'admin_score'>) {
  if (artist.is_flagged) return false

  const status = normalizeArtistStatus(artist.status)
  if (status === 'rejected' || status === 'inactive') return false
  if (status === 'approved') return true

  return (artist.admin_score ?? 0) >= MIN_BOOKABLE_SCORE
}

export async function canArtistManageAvailability(
  artist: Pick<Artist, 'id' | 'status' | 'is_flagged' | 'admin_score'>,
  db: ReturnType<typeof createAdminClient>,
) {
  if (isArtistBookable(artist)) return true

  const { count } = await db
    .from('artist_club_scores')
    .select('id', { count: 'exact', head: true })
    .eq('artist_id', artist.id)
    .eq('approved', true)

  return (count ?? 0) > 0
}

export async function ensureArtistApprovedForAvailability(
  artist: Artist,
  db: ReturnType<typeof createAdminClient>,
) {
  if (isArtistGloballyApproved(artist)) return artist

  const canManage = await canArtistManageAvailability(artist, db)
  if (!canManage) {
    throw new Error('Profilen din må være godkjent før du kan markere tilgjengelige datoer.')
  }

  if (normalizeArtistStatus(artist.status) === 'pending_review') {
    const { data: updated } = await db
      .from('artists')
      .update({ status: 'approved' })
      .eq('id', artist.id)
      .select('*')
      .single()

    if (updated) return updated
  }

  return artist
}

export async function getCurrentArtist() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const pathname = await getRequestPathname()
    const next = pathname.startsWith('/artist-app') ? pathname : '/artist-app'
    redirect(`/artist-app/login?next=${encodeURIComponent(next)}`)
  }

  const db = createAdminClient()
  const { data: artist } = await db
    .from('artists')
    .select('*')
    .eq('auth_user_id', user.id)
    .single()

  if (!artist) {
    redirect('/artist-app/signup?error=missing')
  }

  return { user, artist, db }
}

export function visibleArtistPath(pathname: string) {
  const path = pathname.replace(/^\/artist-app/, '') || '/'
  return path.startsWith('/') ? path : `/${path}`
}

export function formatMoney(amount: number | null | undefined, currency = 'NOK') {
  return new Intl.NumberFormat('nb-NO', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format((amount ?? 0) / 100)
}