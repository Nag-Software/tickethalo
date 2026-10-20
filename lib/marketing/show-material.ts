import { createAdminClient } from '@/lib/supabase/admin'
import { appPath } from '@/lib/app-url'
import { buildMarketingSlots } from '@/lib/marketing/slots'
import { formatTicketPrice } from '@/lib/public-show-format'
import { showVenue } from '@/lib/show-venue'
import type { MarketingCopyInput } from '@/lib/marketing/copy'

/**
 * Alt markedsføringsfanen trenger om ett show, hentet ett sted: kortene i
 * fanen, zip-fila og e-posten bruker den samme lineupen og den samme teksten.
 *
 * Lineupen er den samme som plakatrutene (`buildMarketingSlots`), så en
 * komiker klubben har byttet bilde på i ruten får det bildet her også.
 */

export type MaterialComedian = {
  artistId: string
  name: string
  roleLabel: string
  imageUrl: string | null
  bio: string | null
}

export type ShowMaterial = {
  show: {
    id: string
    clubId: string | null
    title: string
    slug: string
    date: string
    status: string
    posterUrl: string | null
  }
  club: { name: string; supportEmail: string | null } | null
  /** Den offentlige showsiden. QR-koden og e-posten lenker hit. */
  publicUrl: string
  comedians: MaterialComedian[]
  copy: MarketingCopyInput
}

export async function loadShowMaterial(showId: string): Promise<ShowMaterial | null> {
  const db = createAdminClient()
  const { data: show } = await db
    .from('shows')
    .select('id, club_id, title, slug, date, start_time, venue_name, venue_address, description, ticket_price, currency, poster_url, status')
    .eq('id', showId)
    .maybeSingle()
  if (!show) return null

  const [{ data: club }, { data: requirements }, { data: spots }, { data: storedSlots }] = await Promise.all([
    show.club_id
      ? db.from('clubs').select('name, city, support_email').eq('id', show.club_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('show_requirements').select('id, role_name, quantity, lineup_position').eq('show_id', showId),
    db.from('confirmed_spots').select('artist_id, show_requirement_id, status').eq('show_id', showId),
    db.from('show_marketing_slots').select('slot_index, artist_id, image_url').eq('show_id', showId).order('slot_index'),
  ])

  const artistIds = [...new Set((spots ?? []).map((spot) => spot.artist_id))]
  const { data: artists } = artistIds.length
    ? await db.from('artists').select('id, full_name, stage_name, profile_image_url, bio').in('id', artistIds)
    : { data: [] as Array<{ id: string; full_name: string; stage_name: string | null; profile_image_url: string | null; bio: string | null }> }
  const bioById = new Map((artists ?? []).map((artist) => [artist.id, artist.bio]))

  const slots = buildMarketingSlots({
    requirements: requirements ?? [],
    spots: spots ?? [],
    artists: artists ?? [],
    stored: storedSlots ?? [],
  })

  const seen = new Set<string>()
  const comedians: MaterialComedian[] = []
  for (const slot of slots) {
    if (!slot.artistId || !slot.artistName || seen.has(slot.artistId)) continue
    seen.add(slot.artistId)
    comedians.push({
      artistId: slot.artistId,
      name: slot.artistName,
      roleLabel: slot.roleLabel,
      imageUrl: slot.imageUrl,
      bio: bioById.get(slot.artistId)?.trim() || null,
    })
  }

  const publicUrl = appPath(`/events/${show.slug}`)
  const venue = showVenue(show)

  return {
    show: {
      id: show.id,
      clubId: show.club_id,
      title: show.title,
      slug: show.slug,
      date: show.date,
      status: show.status,
      posterUrl: show.poster_url,
    },
    club: club ? { name: club.name, supportEmail: club.support_email?.trim() || null } : null,
    publicUrl,
    comedians,
    copy: {
      title: show.title,
      date: show.date,
      startTime: show.start_time,
      venue: venue.venue,
      city: club?.city ?? null,
      description: show.description,
      ticketUrl: publicUrl,
      priceLabel: show.ticket_price ? formatTicketPrice(show) : null,
      // «Stand-up 2» er en rute i malen, ikke noe publikum trenger å lese.
      // Headliner og host er det som sier noe.
      lineup: comedians.map((comedian) => {
        const role = comedian.roleLabel.replace(/\s+\d+$/, '')
        return { name: comedian.name, roleLabel: role === 'Headliner' || role === 'Host' ? role : null }
      }),
    },
  }
}
