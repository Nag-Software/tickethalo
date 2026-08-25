/**
 * Bilderutene i malen, matchet mot bookingene.
 *
 * En mal med sju ruter skal ikke fylles i den rekkefølgen artistene tilfeldigvis
 * takket ja. Rutene er rangert som på en plakat — headlineren først, så
 * konferansieren, så resten i lineup-rekkefølge — og bookingene legges inn i
 * samme rangering. Ruten merket «Headliner» får dermed headlinerens bilde uten
 * at noen har dratt noe noe sted.
 *
 * Klubben kan alltid overstyre: `show_marketing_slots` er lagrede valg, og de
 * vinner over den automatiske matchingen.
 *
 * Ingen Node-avhengigheter: både server og klient bruker den.
 */

import { normalizeArtistRole } from '@/lib/artist-roles'

/** Lav verdi = høyt på plakaten. */
const ROLE_RANK: Record<string, number> = {
  headliner: 0,
  konferansier: 1,
  'stand-up': 2,
  'open mic': 3,
}

export type SlotRequirement = {
  id: string
  role_name: string
  quantity: number
  lineup_position: number
}

export type SlotSpot = {
  artist_id: string
  show_requirement_id: string
  status: string
}

export type SlotArtist = {
  id: string
  full_name: string
  stage_name: string | null
  profile_image_url: string | null
}

/** Et lagret valg fra `show_marketing_slots`. */
export type StoredSlot = {
  slot_index: number
  artist_id: string | null
  image_url: string | null
}

export type MarketingSlot = {
  slotIndex: number
  /** «Headliner», «Stand-up 2» — teksten som står ved ruten i malen. */
  roleLabel: string
  /** Hvilken booking ruten kommer fra. Null = tom rute i malen. */
  artistId: string | null
  artistName: string | null
  /** Bildet ruten faktisk bruker: overstyringen, ellers profilbildet. */
  imageUrl: string | null
  /** Artistens eget profilbilde, uavhengig av overstyring. */
  profileImageUrl: string | null
  /** True når klubben har lastet opp et eget bilde til ruten. */
  hasCustomImage: boolean
  /** True når ruten er satt for hånd i stedet for automatisk. */
  isManual: boolean
}

const ACTIVE_SPOT_STATUSES = new Set(['confirmed', 'completed', 'paid'])

export function artistDisplayName(artist: SlotArtist | undefined | null): string {
  if (!artist) return 'Unknown artist'
  return artist.stage_name ?? artist.full_name
}

/**
 * Rangerer bookingene slik en plakat leser dem: rolle først, så posisjon.
 * Rekkefølgen er stabil, så en ny artist på en støttespot flytter ikke
 * headlinerens bilde.
 */
function rankRequirements(requirements: SlotRequirement[]): SlotRequirement[] {
  return [...requirements].sort((a, b) => {
    const rankA = ROLE_RANK[normalizeArtistRole(a.role_name) ?? ''] ?? 9
    const rankB = ROLE_RANK[normalizeArtistRole(b.role_name) ?? ''] ?? 9
    if (rankA !== rankB) return rankA - rankB
    if (a.lineup_position !== b.lineup_position) return a.lineup_position - b.lineup_position
    return a.id.localeCompare(b.id)
  })
}

function slotLabel(roleName: string, indexWithinRole: number, totalForRole: number): string {
  const canonical = normalizeArtistRole(roleName)
  const base = canonical === 'headliner' ? 'Headliner'
    : canonical === 'konferansier' ? 'Host'
    : canonical === 'stand-up' ? 'Stand-up'
    : canonical === 'open mic' ? 'Open Mic'
    : roleName
  return totalForRole > 1 ? `${base} ${indexWithinRole + 1}` : base
}

/**
 * Bygger ruteplanen for showet.
 *
 * `templateSlotCount` er antall ruter i den valgte malen. Har malen flere ruter
 * enn showet har artister, blir de siste tomme — det er informasjon klubben
 * trenger, ikke noe vi skal skjule.
 */
export function buildMarketingSlots(input: {
  requirements: SlotRequirement[]
  spots: SlotSpot[]
  artists: SlotArtist[]
  stored?: StoredSlot[]
  templateSlotCount?: number | null
}): MarketingSlot[] {
  const artistById = new Map(input.artists.map((artist) => [artist.id, artist]))
  const storedByIndex = new Map((input.stored ?? []).map((slot) => [slot.slot_index, slot]))
  const activeSpots = input.spots.filter((spot) => ACTIVE_SPOT_STATUSES.has(spot.status))

  const spotsByRequirement = new Map<string, SlotSpot[]>()
  for (const spot of activeSpots) {
    const bucket = spotsByRequirement.get(spot.show_requirement_id)
    if (bucket) bucket.push(spot)
    else spotsByRequirement.set(spot.show_requirement_id, [spot])
  }

  const planned: Array<{ roleLabel: string; artistId: string | null }> = []
  for (const requirement of rankRequirements(input.requirements)) {
    const filled = spotsByRequirement.get(requirement.id) ?? []
    const total = Math.max(requirement.quantity, filled.length)
    for (let index = 0; index < total; index++) {
      planned.push({
        roleLabel: slotLabel(requirement.role_name, index, total),
        artistId: filled[index]?.artist_id ?? null,
      })
    }
  }

  // Artister som er bekreftet på et krav som er slettet siden, skal ikke
  // forsvinne fra plakaten bare fordi kravet gjorde det.
  const plannedArtistIds = new Set(planned.map((slot) => slot.artistId).filter(Boolean))
  for (const spot of activeSpots) {
    if (plannedArtistIds.has(spot.artist_id)) continue
    plannedArtistIds.add(spot.artist_id)
    planned.push({ roleLabel: 'Stand-up', artistId: spot.artist_id })
  }

  const slotCount = Math.max(planned.length, input.templateSlotCount ?? 0, storedByIndex.size)

  return Array.from({ length: slotCount }, (_, index) => {
    const slotIndex = index + 1
    const auto = planned[index] ?? { roleLabel: `Slot ${slotIndex}`, artistId: null }
    const stored = storedByIndex.get(slotIndex)

    // `artist_id: null` på en lagret rad er et bevisst «la ruten stå tom»,
    // og skal ikke falle tilbake på den automatiske matchen.
    const isManual = stored !== undefined
    const artistId = isManual ? stored.artist_id : auto.artistId
    const artist = artistId ? artistById.get(artistId) : undefined
    const customImage = stored?.image_url ?? null

    return {
      slotIndex,
      roleLabel: auto.roleLabel,
      artistId: artistId ?? null,
      artistName: artist ? artistDisplayName(artist) : null,
      imageUrl: customImage ?? artist?.profile_image_url ?? null,
      profileImageUrl: artist?.profile_image_url ?? null,
      hasCustomImage: Boolean(customImage),
      isManual,
    }
  })
}

/**
 * Hvor godt en mal passer lineupen.
 *
 * En mal uten oppgitt rutetall («0») kan brukes til alt, men skal ikke stå
 * øverst i lista foran en mal som faktisk har riktig antall ruter.
 */
export function templateFit(slotCount: number, lineupSize: number): {
  score: number
  label: string
  tone: 'exact' | 'close' | 'unknown' | 'off'
} {
  if (!slotCount) return { score: 2, label: 'Slot count unknown', tone: 'unknown' }
  if (slotCount === lineupSize) return { score: 0, label: `${slotCount} slots — exact fit`, tone: 'exact' }

  const diff = Math.abs(slotCount - lineupSize)
  if (diff <= 1) {
    return {
      score: 1,
      label: slotCount > lineupSize ? `${slotCount} slots — one stays empty` : `${slotCount} slots — one artist won't fit`,
      tone: 'close',
    }
  }

  return { score: 3 + diff, label: `${slotCount} slots`, tone: 'off' }
}

/** Rutene AI-en faktisk kan tegne — de som har både artist og bilde. */
export function usableSlots(slots: MarketingSlot[]): MarketingSlot[] {
  return slots.filter((slot) => slot.artistId && slot.imageUrl)
}
