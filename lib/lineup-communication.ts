import { normalizeArtistRole } from '@/lib/artist-roles'
import { showDateLabel } from '@/lib/email/templates'
import { formatWhatsAppNumber } from '@/lib/whatsapp'
import type { ConfirmedSpotStatus } from '@/types/database'

/**
 * Hvem lineupen er, og hva de trenger å vite — delt av meldingen,
 * påminnelsen og gruppechatten på Communication-fanen.
 *
 * Rene funksjoner; oppslagene står i lib/lineup-messages.ts.
 */

/**
 * Hvem en melding går til: de som står i lineupen. Etter showet blir
 * plassen `completed` og `paid`, og en takk etterpå skal også fram.
 * Ubesvarte tilbud og ventelisten får ingenting — de har ikke sagt ja.
 */
export const LINEUP_MESSAGE_STATUSES: ConfirmedSpotStatus[] = ['confirmed', 'completed', 'paid']

export type LineupArtist = {
  id: string
  full_name: string
  stage_name: string | null
  email: string | null
  whatsapp_number: string | null
}

export type LineupSpotRow = {
  id: string
  artist_id: string
  show_requirement_id: string
  status: ConfirmedSpotStatus
}

export type LineupRecipient = {
  artistId: string
  email: string
  name: string
  /** Bare sifre; null = ikke lagt inn, eller ikke samtykket. */
  whatsapp: string | null
}

export function artistName(artist: Pick<LineupArtist, 'full_name' | 'stage_name'>) {
  return artist.stage_name?.trim() || artist.full_name
}

/** Én per komiker, i lineupens rekkefølge. Uten e-postadresse er det ingen å sende til. */
export function lineupRecipients(
  spots: Array<Pick<LineupSpotRow, 'artist_id' | 'status'>>,
  artists: LineupArtist[],
  statuses: ConfirmedSpotStatus[] = LINEUP_MESSAGE_STATUSES,
): LineupRecipient[] {
  const artistById = new Map(artists.map((artist) => [artist.id, artist]))
  const seen = new Set<string>()
  const recipients: LineupRecipient[] = []

  for (const spot of spots) {
    if (!statuses.includes(spot.status) || seen.has(spot.artist_id)) continue
    const artist = artistById.get(spot.artist_id)
    const email = artist?.email?.trim()
    if (!artist || !email) continue
    seen.add(spot.artist_id)
    recipients.push({ artistId: artist.id, email, name: artistName(artist), whatsapp: artist.whatsapp_number })
  }
  return recipients
}

export type LineupHost = { artistId: string; name: string; whatsapp: string | null }

/** Komikeren på Host-plassen. Har showet flere, er det den første i lineupen. */
export function lineupHost(
  requirements: Array<{ id: string; role_name: string }>,
  spots: Array<Pick<LineupSpotRow, 'artist_id' | 'show_requirement_id' | 'status'>>,
  artists: LineupArtist[],
): LineupHost | null {
  const hostRequirements = new Set(
    requirements.filter((requirement) => normalizeArtistRole(requirement.role_name) === 'konferansier').map((requirement) => requirement.id),
  )
  const spot = spots.find((row) => hostRequirements.has(row.show_requirement_id) && LINEUP_MESSAGE_STATUSES.includes(row.status))
  const artist = spot ? artists.find((row) => row.id === spot.artist_id) : null
  return artist ? { artistId: artist.id, name: artistName(artist), whatsapp: artist.whatsapp_number } : null
}

/** Alt påminnelsen og den festede teksten forteller om kvelden. */
export type LineupShowDetails = {
  title: string
  date: string
  /** `HH:MM`. */
  startTime: string | null
  arrivalTime: string | null
  venue: string | null
  address: string | null
  clubName: string
  clubEmail: string | null
  host: LineupHost | null
  groupLink: string | null
}

function contactLine(name: string, ...rest: Array<string | null | undefined>) {
  return [name, ...rest.filter(Boolean)].join(' · ')
}

/**
 * Detaljradene, i Toms rekkefølge: dato, sted, adresse, start, kontakt.
 * `forArtistId` er mottakeren — verten får «You are hosting» i stedet for
 * sitt eget nummer.
 */
export function lineupDetailRows(details: LineupShowDetails, forArtistId?: string | null): Array<[string, string]> {
  const rows: Array<[string, string | null]> = [
    ['Date', showDateLabel(details.date)],
    ['Venue', details.venue],
    ['Address', details.address],
    ['Show starts', details.startTime],
    ['Arrive by', details.arrivalTime],
    ['Club contact', contactLine(details.clubName, details.clubEmail)],
    [
      'Host',
      details.host
        ? details.host.artistId === forArtistId
          ? 'You are hosting'
          : contactLine(details.host.name, formatWhatsAppNumber(details.host.whatsapp))
        : null,
    ],
  ]
  return rows.filter((row): row is [string, string] => Boolean(row[1]))
}

/** Teksten klubben fester øverst i gruppechatten. */
export function pinnedInfo(details: LineupShowDetails) {
  return [details.title, ...lineupDetailRows(details).map(([label, value]) => `${label}: ${value}`)].join('\n')
}
