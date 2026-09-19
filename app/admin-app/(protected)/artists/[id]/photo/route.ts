import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClubAccess } from '@/lib/club-auth'
import {
  artistPhotoFileName,
  attachmentDisposition,
  isAllowedPhotoUrl,
  photoExtension,
} from '@/lib/artist-photo'

export const runtime = 'nodejs'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Laster ned komikerens profilbilde med navnet på profilen som filnavn.
 * Hvorfor dette går gjennom serveren står i `lib/artist-photo.ts`.
 */
export async function GET(_request: Request, ctx: RouteContext<'/admin-app/artists/[id]/photo'>) {
  const { id } = await ctx.params
  if (!UUID_PATTERN.test(id)) return new NextResponse('Not found', { status: 404 })

  // Samme tilgang som profilsiden: en innlogget klubbadmin eller superadmin.
  const access = await getClubAccess()
  if (!access.isSuperadmin && access.clubs.length === 0) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { data: artist } = await createAdminClient()
    .from('artists')
    .select('full_name, stage_name, profile_image_url')
    .eq('id', id)
    .maybeSingle()

  if (!artist?.profile_image_url || !isAllowedPhotoUrl(artist.profile_image_url)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const upstream = await fetch(artist.profile_image_url, { redirect: 'error' }).catch(() => null)
  const contentType = upstream?.headers.get('content-type') ?? null
  if (!upstream?.ok || !upstream.body || !contentType?.startsWith('image/')) {
    return new NextResponse('The photo could not be fetched.', { status: 502 })
  }

  // Samme navn som står øverst på profilen.
  const name = artist.stage_name?.trim() || artist.full_name
  const fileName = artistPhotoFileName(name, photoExtension(contentType, artist.profile_image_url))

  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': attachmentDisposition(fileName),
      'Cache-Control': 'private, no-store',
    },
  })
}
