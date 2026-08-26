'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  sendBookingOfferEmail,
  sendBookingConfirmedEmail,
  sendOfferDeclinedEmail,
  sendSpotFilledEmail,
  sendSpotAvailableEmail,
} from '@/lib/email/mailer'
import { generateShowPoster } from '@/lib/actions/ai'
import { resolvePalette } from '@/lib/marketing/palette'
import { artistMatchesRole, normalizeArtistRole } from '@/lib/artist-roles'
import { requirementFeeLabel } from '@/lib/booking-spots'
import type { RequirementCompensationType } from '@/types/database'
import { MIN_BOOKABLE_SCORE } from '@/lib/artist-readiness'
import { getClubForShow, isClubPayoutReady, missingReadinessLabels } from '@/lib/stripe-connect'

const ACTIVE_BOOKING_STATUSES = ['booking'] as const

/**
 * Honoraret, rollen og stedet slik komikeren skal lese tilbudet.
 *
 * Et fast honorar kopieres til `booking_offers.fee_amount` når tilbudet
 * opprettes — uten det står tilbudssiden igjen med «ikke satt» selv om
 * bookeren har satt honoraret på lineup-plassen. Prosentavtaler har ikke
 * noe beløp, og leses fra lineup-plassen både i mailen og på siden.
 */
type OfferShow = {
  start_time: string | null
  venue_name: string | null
  venue_address: string | null
  currency: string | null
}

type OfferRequirement = {
  role_name: string
  compensation_type: RequirementCompensationType | null
  compensation_amount: number | null
  compensation_percent: number | null
}

/** Sju dager, men aldri lenger enn til showet. */
const OFFER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Når et tilbud går ut.
 *
 * Sto det bare «om sju dager», kunne en komiker takke ja til et show som
 * allerede var spilt — og et tilbud på et show om to dager ville stå åpent
 * lenge etter at plassen måtte vært fylt.
 */
function offerExpiry(showDate: string | null | undefined) {
  const window = Date.now() + OFFER_WINDOW_MS
  const showEnd = showDate ? Date.parse(`${showDate}T23:59:59Z`) : Number.NaN

  return new Date(Number.isNaN(showEnd) ? window : Math.min(window, showEnd)).toISOString()
}

/**
 * Merker tilbud som har gått ut.
 *
 * Utløpet ble før bare vurdert når komikeren selv åpnet lenken, så et tilbud
 * ingen svarte på ble stående `sent` for alltid. Automatikken teller de
 * åpne tilbudene når den avgjør hvor mange nye den kan sende — to ubesvarte
 * e-poster kunne dermed stoppe bookingen av en plass permanent.
 */
export async function expireStaleOffers(showId?: string) {
  const admin = createAdminClient()
  let query = admin
    .from('booking_offers')
    .update({ status: 'expired', responded_at: new Date().toISOString() })
    .eq('status', 'sent')
    .lt('expires_at', new Date().toISOString())

  if (showId) query = query.eq('show_id', showId)

  const { data, error } = await query.select('id')
  if (error) {
    console.error(`[Booking] Could not expire stale offers: ${error.message}`)
    return 0
  }

  return data?.length ?? 0
}

function offerDetails(show: OfferShow, requirement: OfferRequirement) {
  const currency = show.currency || 'NOK'
  return {
    currency,
    feeAmount: requirement.compensation_type === 'fixed' ? requirement.compensation_amount : null,
    fee_label: requirementFeeLabel(requirement, currency),
    role_name: requirement.role_name,
    show_time: show.start_time?.slice(0, 5) ?? null,
    venue: [show.venue_name, show.venue_address].filter(Boolean).join(', ') || null,
  }
}

// ─── Scoring config ───────────────────────────────────────────────────────────

type ScoringConfig = {
  quality_weight: number
  availability_bonus: number
  role_match_bonus: number
  busy_penalty_per_booking: number
  busy_window_days: number
  offers_per_slot: number
  fallback_limit: number
}

const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  quality_weight: 100,
  availability_bonus: 30,
  role_match_bonus: 15,
  busy_penalty_per_booking: 15,
  busy_window_days: 30,
  offers_per_slot: 10,
  fallback_limit: 5,
}

async function loadScoringConfig(admin: ReturnType<typeof createAdminClient>): Promise<ScoringConfig> {
  const { data } = await admin.from('booking_scoring_config').select('*').eq('id', 'default').single()
  if (!data) return DEFAULT_SCORING_CONFIG
  return {
    quality_weight: Number(data.quality_weight),
    availability_bonus: Number(data.availability_bonus),
    role_match_bonus: Number(data.role_match_bonus),
    busy_penalty_per_booking: Number(data.busy_penalty_per_booking),
    busy_window_days: data.busy_window_days,
    offers_per_slot: data.offers_per_slot,
    fallback_limit: data.fallback_limit,
  }
}

/**
 * Counts confirmed bookings per artist for shows in the last N days + all future shows.
 * Used to deprioritise artists who are already heavily booked.
 */
async function buildBusyMap(
  admin: ReturnType<typeof createAdminClient>,
  windowDays: number,
): Promise<Map<string, number>> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - windowDays)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const { data: windowShows } = await admin.from('shows').select('id').gte('date', cutoffStr)
  if (!windowShows?.length) return new Map()

  const { data: spots } = await admin
    .from('confirmed_spots')
    .select('artist_id')
    .in('show_id', windowShows.map(s => s.id))
    .in('status', ['confirmed', 'completed', 'paid'])

  const busyMap = new Map<string, number>()
  for (const spot of spots ?? []) {
    busyMap.set(spot.artist_id, (busyMap.get(spot.artist_id) ?? 0) + 1)
  }
  return busyMap
}

type ArtistRow = {
  id: string
  email: string
  full_name: string
  admin_score: number | null
  admin_energy_level: string | null
  gender: string | null
  category: string[] | null
}

type RequirementRow = {
  id: string
  role_name: string
  quantity: number
  min_score: number | null
  energy_level: string
  required_gender: string
}

/**
 * Priority score for a candidate artist.
 * Higher = more likely to receive an offer.
 */
function computeScore(
  artist: ArtistRow,
  roleName: string,
  config: ScoringConfig,
  availableSet: Set<string>,
  busyMap: Map<string, number>,
): number {
  const quality     = ((artist.admin_score ?? 0) / 10) * config.quality_weight
  const availability = availableSet.has(artist.id) ? config.availability_bonus : 0
  const roleMatch   = artistMatchesRole(roleName, artist) ? config.role_match_bonus : 0
  const penalty     = (busyMap.get(artist.id) ?? 0) * config.busy_penalty_per_booking
  return quality + availability + roleMatch - penalty
}

function strictFilter(
  artist: ArtistRow,
  req: RequirementRow,
  alreadyInvolved: Set<string>,
): boolean {
  if (alreadyInvolved.has(artist.id)) return false
  if (!matchesHardRequirements(artist, req)) return false
  const minScore = Math.max(req.min_score ?? MIN_BOOKABLE_SCORE, MIN_BOOKABLE_SCORE)
  if ((artist.admin_score ?? 0) < minScore) return false
  return true
}

function matchesHardRequirements(artist: ArtistRow, req: RequirementRow): boolean {
  if (!artistMatchesRole(req.role_name, artist)) return false
  if (req.energy_level !== 'any' && artist.admin_energy_level !== req.energy_level) return false
  if (req.required_gender && req.required_gender !== 'any' && artist.gender !== req.required_gender) return false
  return true
}

function requirementRolePriority(roleName: string | null | undefined) {
  const role = normalizeArtistRole(roleName)
  if (role === 'konferansier') return 0
  if (role === 'headliner') return 1
  if (role === 'stand-up') return 2
  if (role === 'open mic') return 3
  return 4
}

/**
 * Fallback: only called when zero artists pass strict criteria.
 * Relaxes score step-by-step, but never relaxes role, energy or gender.
 * Sorted by admin_score only (not the new composite formula).
 */
function selectFallbackCandidates(
  allArtists: ArtistRow[],
  req: RequirementRow,
  alreadyInvolved: Set<string>,
  limit: number,
): ArtistRow[] {
  const minScore = Math.max(req.min_score ?? MIN_BOOKABLE_SCORE, MIN_BOOKABLE_SCORE)
  const base = allArtists.filter(a => !alreadyInvolved.has(a.id) && matchesHardRequirements(a, req))
  const byScore = (a: ArtistRow, b: ArtistRow) => (b.admin_score ?? 0) - (a.admin_score ?? 0)

  const steps: Array<(a: ArtistRow) => boolean> = [
    a => (a.admin_score ?? 0) >= minScore - 1,
    a => (a.admin_score ?? 0) >= minScore - 2,
  ]

  for (const step of steps) {
    const found = base.filter(step).sort(byScore).slice(0, limit)
    if (found.length > 0) return found
  }
  return []
}

// ─────────────────────────────────────────────────────────────────────────────

function publicAppUrl() {
  const origin =
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    'http://localhost:3000'
  return origin.replace(/\/$/, '')
}



/**
 * Book show: selects and sends offers for all unfilled requirements.
 *
 * Scoring (configurable via booking_scoring_config table):
 *   score = (admin_score/10 × quality_weight) + availability_bonus? + role_match_bonus? − busy_count × busy_penalty
 *
 * Round-based assignment:
 *   1. Count open slots and existing pending offers per requirement.
 *   2. Send offers in rounds, one wave per open slot, across all requirements.
 *      This prevents the first identical role from consuming the whole pool.
 *   3. effectiveInvolved grows as artists are assigned, so each artist only gets
 *      one active opportunity per show.
 * Falls back to relaxed criteria only when no strict candidates remain for a requirement.
 */
export async function bookShow(showId: string) {
  const admin = createAdminClient()
  let offersCreated = 0
  let candidatesMatched = 0

  const { data: show, error: showError } = await admin
    .from('shows')
    .select('id, title, date, start_time, venue_name, venue_address, currency, status')
    .eq('id', showId)
    .single()
  if (showError || !show) throw new Error('Show not found')
  if (!ACTIVE_BOOKING_STATUSES.includes(show.status as (typeof ACTIVE_BOOKING_STATUSES)[number])) {
    return { offersCreated, candidatesMatched }
  }

  const { data: requirements, error: reqError } = await admin
    .from('show_requirements')
    .select('*')
    .eq('show_id', showId)
    .order('lineup_position')
    .order('created_at')
  if (reqError) throw new Error(reqError.message)
  if (!requirements?.length) return { offersCreated, candidatesMatched }

  // Må skje før tilbudene telles: et utløpt tilbud som fortsatt står `sent`
  // spiser en plass i kvoten under, og da sendes det aldri et nytt.
  await expireStaleOffers(showId)

  const [config, { data: availableRows }, { data: allArtists }] = await Promise.all([
    loadScoringConfig(admin),
    admin.from('artist_availability').select('artist_id').eq('available_date', show.date),
    admin.from('artists')
      .select('id, email, full_name, admin_score, admin_energy_level, gender, category')
      .eq('status', 'approved')
      .eq('is_flagged', false),
  ])
  if (!allArtists?.length) return { offersCreated, candidatesMatched }

  const availableSet = new Set((availableRows ?? []).map(r => r.artist_id))
  const busyMap = await buildBusyMap(admin, config.busy_window_days)

  const [{ data: existingOffers }, { data: existingSpots }, { data: excludedArtists }] = await Promise.all([
    // 'declined' må være med. Uten den faller en artist som nettopp takket
    // nei rett tilbake i kandidatlisten, og siden declineBookingOffer kjører
    // motoren med én gang, fikk de det samme showet tilbudt på nytt umiddelbart.
    // Statusene her mates inn i `alreadyInvolved`, som både strictFilter og
    // selectFallbackCandidates sjekker.
    admin.from('booking_offers').select('id, artist_id, show_requirement_id, status').eq('show_id', showId).in('status', ['sent', 'accepted', 'declined']),
    admin.from('confirmed_spots').select('artist_id').eq('show_id', showId).in('status', ['confirmed', 'completed', 'paid']),
    admin.from('show_artist_booking_exclusions').select('artist_id').eq('show_id', showId),
  ])

  const excludedArtistIds = new Set((excludedArtists ?? []).map(row => row.artist_id))
  const artistById = new Map((allArtists as ArtistRow[]).map(artist => [artist.id, artist]))
  const requirementById = new Map((requirements ?? []).map(req => [req.id, req]))
  const invalidPendingOfferIds = (existingOffers ?? []).flatMap((offer) => {
    if (offer.status !== 'sent' || !offer.show_requirement_id) return []
    if (excludedArtistIds.has(offer.artist_id)) return [offer.id]
    const artist = artistById.get(offer.artist_id)
    const req = requirementById.get(offer.show_requirement_id)
    return artist && req && matchesHardRequirements(artist, req) ? [] : [offer.id]
  })

  if (invalidPendingOfferIds.length > 0) {
    await admin
      .from('booking_offers')
      .update({ status: 'cancelled', responded_at: new Date().toISOString() })
      .in('id', invalidPendingOfferIds)
  }

  const activeExistingOffers = (existingOffers ?? []).filter(
    offer => !invalidPendingOfferIds.includes(offer.id)
  )

  const alreadyInvolved = new Set([
    ...activeExistingOffers.map(o => o.artist_id),
    ...(existingSpots ?? []).map(s => s.artist_id),
    ...excludedArtistIds,
  ])

  const pendingOffersByRequirement = new Map<string, number>()
  for (const offer of activeExistingOffers) {
    if (offer.status !== 'sent' || !offer.show_requirement_id) continue
    pendingOffersByRequirement.set(
      offer.show_requirement_id,
      (pendingOffersByRequirement.get(offer.show_requirement_id) ?? 0) + 1,
    )
  }

  const reqEntries: Array<{
    req: NonNullable<typeof requirements>[number]
    slotsNeeded: number
    currentPendingOffers: number
    initialStrictCount: number
    maxNewOffers: number
  }> = []

  for (const req of requirements) {
    const { count: filled } = await admin
      .from('confirmed_spots')
      .select('*', { count: 'exact', head: true })
      .eq('show_requirement_id', req.id)
      .in('status', ['confirmed', 'completed', 'paid'])

    const slotsNeeded = req.quantity - (filled ?? 0)
    if (slotsNeeded <= 0) continue

    const targetPendingOffers = slotsNeeded * config.offers_per_slot
    const currentPendingOffers = pendingOffersByRequirement.get(req.id) ?? 0
    const maxNewOffers = Math.max(0, targetPendingOffers - currentPendingOffers)
    if (maxNewOffers <= 0) continue

    const initialStrictCount = (allArtists as ArtistRow[]).filter(a => strictFilter(a, req, alreadyInvolved)).length
    reqEntries.push({ req, slotsNeeded, currentPendingOffers, initialStrictCount, maxNewOffers })
  }

  if (!reqEntries.length) return { offersCreated, candidatesMatched }

  const effectiveInvolved = new Set(alreadyInvolved)
  const assignments: Array<{ artistId: string; req: NonNullable<typeof requirements>[number] }> = []
  const assignedByRequirement = new Map<string, number>()

  function chooseCandidates(
    req: NonNullable<typeof requirements>[number],
    limit: number,
    fallbackLimit: number,
  ) {
    let candidates = (allArtists as ArtistRow[])
      .filter(a => strictFilter(a, req, effectiveInvolved))
      .sort((a, b) => computeScore(b, req.role_name, config, availableSet, busyMap) - computeScore(a, req.role_name, config, availableSet, busyMap))
      .slice(0, limit)

    if (candidates.length === 0 && fallbackLimit > 0) {
      candidates = selectFallbackCandidates(allArtists as ArtistRow[], req, effectiveInvolved, Math.min(limit, fallbackLimit))
    }

    return candidates
  }

  function assignCandidates(req: NonNullable<typeof requirements>[number], candidates: ArtistRow[]) {
    for (const artist of candidates) {
      effectiveInvolved.add(artist.id)
      assignments.push({ artistId: artist.id, req })
      assignedByRequirement.set(req.id, (assignedByRequirement.get(req.id) ?? 0) + 1)
    }
  }

  const coverageEntries = [...reqEntries]
    .filter(entry => entry.currentPendingOffers < entry.slotsNeeded)
    .sort((a, b) => {
      const aMissing = a.slotsNeeded - a.currentPendingOffers
      const bMissing = b.slotsNeeded - b.currentPendingOffers
      return requirementRolePriority(a.req.role_name) - requirementRolePriority(b.req.role_name)
        || bMissing - aMissing
        || a.req.lineup_position - b.req.lineup_position
        || a.initialStrictCount - b.initialStrictCount
    })

  for (const entry of coverageEntries) {
    const alreadyAssignedForReq = assignedByRequirement.get(entry.req.id) ?? 0
    const missingCoverage = Math.max(0, entry.slotsNeeded - entry.currentPendingOffers - alreadyAssignedForReq)
    const remainingForReq = entry.maxNewOffers - alreadyAssignedForReq
    if (missingCoverage <= 0 || remainingForReq <= 0) continue

    const fallbackRemaining = Math.max(0, config.fallback_limit - alreadyAssignedForReq)
    const candidates = chooseCandidates(entry.req, Math.min(missingCoverage, remainingForReq), fallbackRemaining)
    assignCandidates(entry.req, candidates)
  }

  const extraEntries = [...reqEntries].sort((a, b) => {
    const rolePriority = requirementRolePriority(a.req.role_name) - requirementRolePriority(b.req.role_name)
    if (rolePriority !== 0) return rolePriority

    if ((a.initialStrictCount === 0) !== (b.initialStrictCount === 0)) {
      return a.initialStrictCount === 0 ? 1 : -1
    }
    return a.initialStrictCount - b.initialStrictCount
      || a.req.lineup_position - b.req.lineup_position
  })

  const maxRounds = Math.max(...extraEntries.map(entry => Math.ceil(entry.maxNewOffers / entry.slotsNeeded)))

  for (let round = 0; round < maxRounds; round++) {
    for (const { req, slotsNeeded, maxNewOffers } of extraEntries) {
      const alreadyAssignedForReq = assignedByRequirement.get(req.id) ?? 0
      const remainingForReq = maxNewOffers - alreadyAssignedForReq
      if (remainingForReq <= 0) continue

      const waveSize = Math.min(slotsNeeded, remainingForReq)
      const fallbackRemaining = Math.max(0, config.fallback_limit - alreadyAssignedForReq)
      const candidates = chooseCandidates(req, waveSize, fallbackRemaining)
      assignCandidates(req, candidates)
    }
  }

  candidatesMatched = assignments.length
  if (!assignments.length) return { offersCreated, candidatesMatched }

  const baseUrl = publicAppUrl()
  for (const { artistId, req } of assignments) {
    const artist = (allArtists as ArtistRow[]).find(a => a.id === artistId)!
    const details = offerDetails(show, req)
    const { data: offer, error: offerError } = await admin
      .from('booking_offers')
      .insert({
        show_id: showId,
        artist_id: artist.id,
        show_requirement_id: req.id,
        status: 'sent',
        sent_at: new Date().toISOString(),
        expires_at: offerExpiry(show.date),
        fee_amount: details.feeAmount,
        currency: details.currency,
      })
      .select('token')
      .single()

    if (offerError || !offer) continue
    offersCreated++

    await sendBookingOfferEmail({
      email: artist.email,
      full_name: artist.full_name,
      show_title: show.title,
      show_date: show.date,
      show_time: details.show_time,
      venue: details.venue,
      role_name: details.role_name,
      fee_label: details.fee_label,
      token: offer.token,
      response_url: `${baseUrl}/booking-offer/${offer.token}`,
    })
  }

  return { offersCreated, candidatesMatched }
}




/**
 * @deprecated Fallback logic is now built into bookShow. Kept for import compatibility.
 */
export async function sendFallbackOffersForShow(_showId: string) {
  void _showId
  return { offersCreated: 0 }
}

export async function runAutomaticBookingForShow(showId: string) {
  const booking = await bookShow(showId)
  const fullbooked = await automateFullbookedShow(showId)
  return { booking, fullbooked }
}

export async function runAutomaticBookingForOpenShows() {
  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const { data: shows } = await admin
    .from('shows')
    .select('id')
    .in('status', [...ACTIVE_BOOKING_STATUSES])
    .gte('date', today)
    .order('date', { ascending: true })

  const results = []
  for (const show of shows ?? []) {
    results.push(await runAutomaticBookingForShow(show.id))
  }
  return results
}

/**
 * Publiserer showet når alle lineup-plasser er fylt.
 *
 * `force: true` hopper over fyllingssjekken slik at bookeren i klubben kan
 * publisere en delvis fylt lineup manuelt. Plakat genereres da fra de
 * artistene som faktisk er bekreftet, og resterende tilbud lever videre —
 * godkjennes de senere, oppdateres lineupen på det allerede publiserte showet.
 */
export async function automateFullbookedShow(showId: string, options: { force?: boolean } = {}) {
  const admin = createAdminClient()
  const force = options.force === true

  const { data: requirements } = await admin
    .from('show_requirements')
    .select('id, role_name, quantity')
    .eq('show_id', showId)

  if (!requirements?.length) return { fullbooked: false, reason: 'no_requirements' as const }

  if (!force) {
    for (const req of requirements) {
      const { count } = await admin
        .from('confirmed_spots')
        .select('*', { count: 'exact', head: true })
        .eq('show_requirement_id', req.id)
        .in('status', ['confirmed', 'completed', 'paid'])

      if ((count ?? 0) < req.quantity) {
        return {
          fullbooked: false,
          reason: 'requirements_not_filled' as const,
          message: `Krav "${req.role_name}" er ikke fylt (${count ?? 0}/${req.quantity})`,
        }
      }
    }
  }

  const { data: show } = await admin
    .from('shows')
    .select('title, slug, date, start_time, venue_name, venue_address, poster_url, published_at, selected_marketing_design_id, auto_poster_enabled, marketing_palette, club_id')
    .eq('id', showId)
    .single()

  if (!show) return { fullbooked: false, reason: 'show_not_found' as const }

  // Denne funksjonen publiserer showet, også fra cron. Er klubbens
  // Connect-konto ikke ferdig, ville billettsalget åpnet uten en selger å ta
  // imot pengene på vegne av.
  const club = await getClubForShow(showId)
  if (!isClubPayoutReady(club)) {
    return {
      fullbooked: false,
      reason: 'club_not_payable' as const,
      message: `Klubben mangler: ${missingReadinessLabels(club).join(', ')}`,
    }
  }

  const { data: spots } = await admin
    .from('confirmed_spots')
    .select('artist_id, show_requirement_id')
    .eq('show_id', showId)
    .in('status', ['confirmed', 'completed', 'paid'])

  if (force && (spots ?? []).length === 0) {
    return {
      fullbooked: false,
      reason: 'no_confirmed_artists' as const,
      message: 'Minst én artist må være bekreftet før lineupen kan publiseres.',
    }
  }

  const artistIds = [...new Set((spots ?? []).map((spot) => spot.artist_id))]
  const { data: artistRows } = artistIds.length > 0
    ? await admin.from('artists').select('id, full_name, stage_name, profile_image_url').in('id', artistIds)
    : { data: [] as Array<{ id: string; full_name: string; stage_name: string | null; profile_image_url: string | null }> }
  const artistById = new Map((artistRows ?? []).map((artist) => [artist.id, artist]))
  const requirementById = new Map((requirements ?? []).map((requirement) => [requirement.id, requirement.role_name]))

  let posterUrl = show.poster_url ?? null

  // AI-plakaten lages ikke lenger av seg selv. De fleste klubber har sin egen
  // plakat, og en generert plakat som overrasker dem på publiseringstidspunktet
  // er verre enn ingen plakat. `auto_poster_enabled` er av som standard, og
  // klubben skrur den på per show i markedsføringsfanen om den vil ha den.
  if (!posterUrl && show.auto_poster_enabled) {
    const { data: clubBrand } = show.club_id
      ? await admin.from('clubs').select('brand_color').eq('id', show.club_id).maybeSingle()
      : { data: null }
    const clubBrandColor = clubBrand?.brand_color ?? null

    // Malen kan ligge i klubbens bibliotek og ikke på showet, så oppslaget går
    // på id alene — tilhørigheten ble sjekket da malen ble valgt.
    const { data: posterDesign } = show.selected_marketing_design_id
      ? await admin
        .from('show_marketing_designs')
        .select('label, file_url, file_path, file_name, mime_type, file_type')
        .eq('id', show.selected_marketing_design_id)
        .maybeSingle()
      : { data: null }

    posterUrl = await generateShowPoster(showId, {
      title: show.title,
      date: show.date,
      startTime: show.start_time,
      venue: show.venue_name ?? show.venue_address ?? '',
      artists: (spots ?? []).flatMap((spot) => {
        const artist = artistById.get(spot.artist_id)
        if (!artist) return []
        return [{
          name: artist.stage_name ?? artist.full_name,
          profile_image_url: artist.profile_image_url,
          role_name: requirementById.get(spot.show_requirement_id) ?? null,
        }]
      }),
      designTemplate: posterDesign
        ? {
          label: posterDesign.label,
          fileUrl: posterDesign.file_url,
          filePath: posterDesign.file_path,
          fileName: posterDesign.file_name,
          mimeType: posterDesign.mime_type,
        }
        : null,
      palette: resolvePalette(show.marketing_palette, clubBrandColor),
    })
  }

  const alreadyPublished = Boolean(show.published_at)
  const publishedAt = show.published_at ?? new Date().toISOString()

  // Publish show and set poster. Transitions from any pre-published status.
  const posterWasGenerated = Boolean(posterUrl) && posterUrl !== show.poster_url

  await admin.from('shows').update({
    status: 'published',
    published_at: publishedAt,
    ...(posterUrl ? { poster_url: posterUrl } : {}),
    ...(posterWasGenerated ? { poster_source: 'ai' as const } : {}),
  }).eq('id', showId).in('status', ['draft', 'booking', 'fullbooked'])

  // If already published, still keep poster in sync without touching status/published_at
  if (posterUrl && alreadyPublished) {
    await admin.from('shows').update({ poster_url: posterUrl })
      .eq('id', showId).eq('status', 'published')
  }

  // Fullbooket-flyten seeder markedsføringsoppgavene i accept_booking_offer.
  // Ved manuell publisering når showet aldri den tilstanden, så seed dem her.
  if (force && !alreadyPublished) {
    await admin.from('marketing_tasks').upsert([
      { show_id: showId, task_key: 'publish_event_page', label: 'Publiser event-side', is_completed: true },
      { show_id: showId, task_key: 'activate_ticket_sales', label: 'Aktiver billettsalg', is_completed: false },
      { show_id: showId, task_key: 'upload_poster', label: 'Plakat på plass', is_completed: Boolean(posterUrl) },
      { show_id: showId, task_key: 'create_facebook_event', label: 'Opprett Facebook-event', is_completed: false },
      { show_id: showId, task_key: 'share_facebook_groups', label: 'Del i Facebook-grupper', is_completed: false },
      { show_id: showId, task_key: 'send_calendar_partners', label: 'Send til kalenderpartnere', is_completed: false },
      { show_id: showId, task_key: 'schedule_email', label: 'Planlegg e-postkampanje', is_completed: false },
    ], { onConflict: 'show_id,task_key', ignoreDuplicates: true })
  }

  return { fullbooked: true, forced: force, posterUrl, published: true, publishedAt }
}

/**
 * 6.6 Accept booking offer (transactional via DB function-level logic)
 */
export async function acceptBookingOffer(token: string) {
  const admin = createAdminClient()

  const { data: accepted, error } = await admin
    .rpc('accept_booking_offer', { p_token: token })
    .single()

  if (error || !accepted) throw new Error(error?.message ?? 'Offer not found or already responded')

  if (accepted.should_notify && accepted.result === 'filled_by_other') {
    const { data: artist } = await admin
      .from('artists')
      .select('email, full_name')
      .eq('id', accepted.artist_id)
      .single()

    if (artist) await sendSpotFilledEmail({ email: artist.email, full_name: artist.full_name })
  }

  if (accepted.should_notify && accepted.result === 'accepted') {
    const [{ data: artist }, { data: show }, { data: requirement }] = await Promise.all([
      admin.from('artists').select('email, full_name').eq('id', accepted.artist_id).single(),
      admin
        .from('shows')
        .select('title, date, start_time, venue_name, venue_address, currency')
        .eq('id', accepted.show_id)
        .single(),
      admin
        .from('show_requirements')
        .select('role_name, compensation_type, compensation_amount, compensation_percent')
        .eq('id', accepted.show_requirement_id)
        .single(),
    ])

    if (artist) {
      const details = show && requirement ? offerDetails(show, requirement) : null
      await sendBookingConfirmedEmail({
        email: artist.email,
        full_name: artist.full_name,
        show_title: show?.title ?? '',
        show_date: show?.date ?? '',
        show_time: details?.show_time,
        venue: details?.venue,
        fee_label: details?.fee_label,
        portal_url: `${publicAppUrl()}/artist-app/bookings`,
      })
    }
  }

  if (['accepted', 'already_booked', 'filled_by_other'].includes(accepted.result)) {
    await runAutomaticBookingForShow(accepted.show_id)
  }

  return { result: accepted.result as 'accepted' | 'filled_by_other' | 'already_booked' | 'declined' | 'expired' | 'cancelled' }
}

export async function acceptBookingOfferById(offerId: string) {
  const admin = createAdminClient()

  const { data: offer, error: offerError } = await admin
    .from('booking_offers')
    .select('id, show_id, artist_id, show_requirement_id, token, status, fee_amount, currency')
    .eq('id', offerId)
    .single()

  if (offerError || !offer) throw new Error(offerError?.message ?? 'Bookingtilbudet finnes ikke.')

  const { data: existingOfferSpot } = await admin
    .from('confirmed_spots')
    .select('id')
    .eq('booking_offer_id', offer.id)
    .in('status', ['confirmed', 'completed', 'paid'])
    .maybeSingle()

  if (existingOfferSpot) {
    await admin
      .from('booking_offers')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('id', offer.id)
    await runAutomaticBookingForShow(offer.show_id)
    return { result: 'accepted' as const, confirmedSpotId: existingOfferSpot.id, repaired: false }
  }

  const { data: existingArtistSpot } = await admin
    .from('confirmed_spots')
    .select('id')
    .eq('show_id', offer.show_id)
    .eq('artist_id', offer.artist_id)
    .in('status', ['confirmed', 'completed', 'paid'])
    .maybeSingle()

  if (existingArtistSpot) {
    await admin
      .from('booking_offers')
      .update({ status: 'cancelled', responded_at: new Date().toISOString() })
      .eq('id', offer.id)
    throw new Error('Denne artisten er allerede i lineupen for dette showet.')
  }

  const [{ data: requirement }, { count: filled }] = await Promise.all([
    admin
      .from('show_requirements')
      .select('quantity, role_name')
      .eq('id', offer.show_requirement_id)
      .single(),
    admin
      .from('confirmed_spots')
      .select('*', { count: 'exact', head: true })
      .eq('show_requirement_id', offer.show_requirement_id)
      .in('status', ['confirmed', 'completed', 'paid']),
  ])

  if (requirement && (filled ?? 0) >= requirement.quantity) {
    await admin
      .from('booking_offers')
      .update({ status: 'filled_by_other', responded_at: new Date().toISOString() })
      .eq('id', offer.id)
    throw new Error(`Rollen "${requirement.role_name}" er allerede fylt.`)
  }

  const { data: spot, error: spotError } = await admin
    .from('confirmed_spots')
    .insert({
      show_id: offer.show_id,
      artist_id: offer.artist_id,
      show_requirement_id: offer.show_requirement_id,
      booking_offer_id: offer.id,
      fee_amount: offer.fee_amount,
      currency: offer.currency,
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (spotError || !spot) throw new Error(spotError?.message ?? 'Kunne ikke opprette lineup-spot.')

  await admin
    .from('booking_offers')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', offer.id)

  const { count: nowFilled } = await admin
    .from('confirmed_spots')
    .select('*', { count: 'exact', head: true })
    .eq('show_requirement_id', offer.show_requirement_id)
    .in('status', ['confirmed', 'completed', 'paid'])

  if (requirement && (nowFilled ?? 0) >= requirement.quantity) {
    await admin
      .from('booking_offers')
      .update({ status: 'filled_by_other' })
      .eq('show_requirement_id', offer.show_requirement_id)
      .eq('status', 'sent')
      .neq('id', offer.id)
  }

  await admin
    .from('booking_offers')
    .update({ status: 'cancelled' })
    .eq('show_id', offer.show_id)
    .eq('artist_id', offer.artist_id)
    .eq('status', 'sent')
    .neq('id', offer.id)

  await runAutomaticBookingForShow(offer.show_id)
  return { result: 'accepted' as const, confirmedSpotId: spot.id, repaired: true }
}

export async function cancelConfirmedSpotForOffer(offerId: string) {
  const admin = createAdminClient()
  await admin
    .from('confirmed_spots')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('booking_offer_id', offerId)
    .in('status', ['confirmed', 'completed', 'paid'])
}

export async function createManualBookingOffer(formData: FormData) {
  const showId = formData.get('show_id') as string
  const artistId = formData.get('artist_id') as string
  const requirementId = formData.get('requirement_id') as string
  const feeRaw = formData.get('fee_amount') as string

  if (!showId || !artistId || !requirementId) throw new Error('Manglende felt')

  const admin = createAdminClient()

  const [{ data: show }, { data: artist }] = await Promise.all([
    admin.from('shows').select('id, title, date').eq('id', showId).single(),
    admin.from('artists').select('id, email, full_name').eq('id', artistId).single(),
  ])

  if (!show || !artist) throw new Error('Show eller artist ikke funnet')

  const { data: offer, error } = await admin
    .from('booking_offers')
    .insert({
      show_id: showId,
      artist_id: artistId,
      show_requirement_id: requirementId,
      status: 'sent',
      sent_at: new Date().toISOString(),
      expires_at: offerExpiry(show.date),
      ...(feeRaw ? { fee_amount: Math.round(parseFloat(feeRaw) * 100), currency: 'NOK' } : {}),
    })
    .select('token')
    .single()

  if (error || !offer) throw new Error(error?.message ?? 'Kunne ikke opprette tilbud')

  await sendBookingOfferEmail({
    email: artist.email,
    full_name: artist.full_name,
    show_title: show.title,
    show_date: show.date,
    token: offer.token,
    response_url: `${publicAppUrl()}/booking-offer/${offer.token}`,
  })

  revalidatePath('/admin-app/bookings')
}

export async function cancelBookingOffer(formData: FormData) {
  const offerId = formData.get('offer_id') as string
  if (!offerId) throw new Error('Mangler offer_id')

  const admin = createAdminClient()
  await admin
    .from('booking_offers')
    .update({ status: 'cancelled', responded_at: new Date().toISOString() })
    .eq('id', offerId)
    .eq('status', 'sent')

  revalidatePath('/admin-app/bookings')
}

/**
 * 6.7 Decline booking offer
 */
export async function declineBookingOffer(token: string) {
  const admin = createAdminClient()

  const { data: offer, error } = await admin
    .from('booking_offers')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('token', token)
    .eq('status', 'sent')
    .select('show_id, artist_id')
    .maybeSingle()

  if (error) throw new Error(error.message)

  // Et nei skal kvitteres like tydelig som et ja — ellers sitter komikeren
  // igjen uten spor av at svaret kom fram.
  if (offer) {
    const [{ data: artist }, { data: show }] = await Promise.all([
      admin.from('artists').select('email, full_name').eq('id', offer.artist_id).single(),
      admin.from('shows').select('title, date').eq('id', offer.show_id).single(),
    ])

    if (artist) {
      await sendOfferDeclinedEmail({
        email: artist.email,
        full_name: artist.full_name,
        show_title: show?.title ?? '',
        show_date: show?.date ?? '',
        portal_url: `${publicAppUrl()}/artist-app/available-dates`,
      })
    }
  }

  // Motoren kjøres for å fylle plassen som nettopp ble ledig. Den ser
  // avslaget via booking_offers-statusen og tilbyr ikke showet til den
  // samme artisten igjen — se kommentaren i bookShow().
  //
  // Vi skriver bevisst ingen rad i show_artist_booking_exclusions her:
  // den tabellen filtrerer også bort artisten fra manuell tildeling i
  // admin, og det finnes ingen måte å angre på. Et avslag skal stoppe
  // automatikken, ikke låse artisten ute fra showet for godt.
  if (offer?.show_id) await runAutomaticBookingForShow(offer.show_id)

  return { result: 'declined' as const }
}

/**
 * Sends new booking offers for a specific requirement that just had its spot removed.
 * Uses "Ledig spot" email instead of the standard booking offer email.
 * Applies the same scoring config and fallback logic as bookShow.
 */
export async function sendOffersForReopenedRequirement(showId: string, requirementId: string) {
  const admin = createAdminClient()

  const [{ data: show }, { data: requirement }] = await Promise.all([
    admin.from('shows').select('id, title, date, start_time, venue_name, venue_address, currency, status').eq('id', showId).single(),
    admin.from('show_requirements').select('*').eq('id', requirementId).single(),
  ])

  if (!show || !requirement) return
  if (!ACTIVE_BOOKING_STATUSES.includes(show.status as (typeof ACTIVE_BOOKING_STATUSES)[number])) return

  const { count: filled } = await admin
    .from('confirmed_spots')
    .select('*', { count: 'exact', head: true })
    .eq('show_requirement_id', requirementId)
    .in('status', ['confirmed', 'completed', 'paid'])

  if ((filled ?? 0) >= requirement.quantity) return

  // Må skje før tilbudene telles: et utløpt tilbud som fortsatt står `sent`
  // spiser en plass i kvoten under, og da sendes det aldri et nytt.
  await expireStaleOffers(showId)

  const [config, { data: availableRows }, { data: allArtists }] = await Promise.all([
    loadScoringConfig(admin),
    admin.from('artist_availability').select('artist_id').eq('available_date', show.date),
    admin.from('artists')
      .select('id, email, full_name, admin_score, admin_energy_level, gender, category')
      .eq('status', 'approved')
      .eq('is_flagged', false),
  ])
  if (!allArtists?.length) return

  const availableSet = new Set((availableRows ?? []).map(r => r.artist_id))
  const busyMap = await buildBusyMap(admin, config.busy_window_days)

  const [{ data: existingOffers }, { data: existingSpots }, { data: excludedArtists }] = await Promise.all([
    admin.from('booking_offers').select('artist_id').eq('show_id', showId).in('status', ['sent', 'declined']),
    admin.from('confirmed_spots').select('artist_id').eq('show_id', showId).in('status', ['confirmed', 'completed', 'paid']),
    admin.from('show_artist_booking_exclusions').select('artist_id').eq('show_id', showId),
  ])
  const alreadyInvolved = new Set([
    ...(existingOffers ?? []).map(o => o.artist_id),
    ...(existingSpots ?? []).map(s => s.artist_id),
    ...(excludedArtists ?? []).map(row => row.artist_id),
  ])

  const slotsNeeded = requirement.quantity - (filled ?? 0)
  let candidates = (allArtists as ArtistRow[])
    .filter(a => strictFilter(a, requirement, alreadyInvolved))
    .sort((a, b) => computeScore(b, requirement.role_name, config, availableSet, busyMap) - computeScore(a, requirement.role_name, config, availableSet, busyMap))
    .slice(0, slotsNeeded * config.offers_per_slot)

  if (candidates.length === 0) {
    candidates = selectFallbackCandidates(allArtists as ArtistRow[], requirement, alreadyInvolved, config.fallback_limit)
  }

  const baseUrl = publicAppUrl()
  const details = offerDetails(show, requirement)
  for (const artist of candidates) {
    const { data: offer, error } = await admin
      .from('booking_offers')
      .insert({
        show_id: showId,
        artist_id: artist.id,
        show_requirement_id: requirementId,
        status: 'sent',
        sent_at: new Date().toISOString(),
        expires_at: offerExpiry(show.date),
        fee_amount: details.feeAmount,
        currency: details.currency,
      })
      .select('token')
      .single()

    if (error || !offer) continue

    await sendSpotAvailableEmail({
      email: artist.email,
      full_name: artist.full_name,
      show_title: show.title,
      show_date: show.date,
      show_time: details.show_time,
      venue: details.venue,
      role_name: details.role_name,
      fee_label: details.fee_label,
      token: offer.token,
      response_url: `${baseUrl}/booking-offer/${offer.token}`,
    })
  }
}


/**
 * Sender et bookingtilbud til én valgt komiker på en gitt lineup-plass.
 *
 * Brukes av "+ Send tilbud" i admin-appen: bookeren velger komiker selv
 * i stedet for å la scoringsmotoren plukke kandidater. Komikeren må
 * fortsatt takke ja før plassen fylles.
 */
export async function sendManualBookingOffer(
  showId: string,
  artistId: string,
  requirementId: string,
) {
  const admin = createAdminClient()

  const [{ data: show }, { data: requirement }, { data: artist }] = await Promise.all([
    admin.from('shows').select('id, title, date, start_time, venue_name, venue_address, currency, status').eq('id', showId).single(),
    admin
      .from('show_requirements')
      .select('id, role_name, quantity, compensation_type, compensation_amount, compensation_percent')
      .eq('id', requirementId)
      .eq('show_id', showId)
      .single(),
    admin.from('artists').select('id, email, full_name').eq('id', artistId).single(),
  ])

  if (!show) throw new Error('Showet finnes ikke.')
  if (!requirement) throw new Error('Denne lineup-plassen tilhører ikke showet.')
  if (!artist) throw new Error('Komikeren finnes ikke.')

  const [{ count: filled }, { data: existingSpot }, { data: existingOffer }] = await Promise.all([
    admin.from('confirmed_spots')
      .select('*', { count: 'exact', head: true })
      .eq('show_requirement_id', requirementId)
      .in('status', ['confirmed', 'completed', 'paid']),
    admin.from('confirmed_spots')
      .select('id')
      .eq('show_id', showId)
      .eq('artist_id', artistId)
      .in('status', ['confirmed', 'completed', 'paid'])
      .maybeSingle(),
    admin.from('booking_offers')
      .select('id')
      .eq('show_id', showId)
      .eq('artist_id', artistId)
      .eq('status', 'sent')
      .maybeSingle(),
  ])

  if ((filled ?? 0) >= requirement.quantity) throw new Error('Denne lineup-plassen er allerede fylt.')
  if (existingSpot) throw new Error('Denne komikeren er allerede i lineupen.')
  if (existingOffer) throw new Error('Denne komikeren har allerede et tilbud som venter på svar.')

  const details = offerDetails(show, requirement)
  const { data: offer, error } = await admin
    .from('booking_offers')
    .insert({
      show_id: showId,
      artist_id: artistId,
      show_requirement_id: requirementId,
      status: 'sent',
      sent_at: new Date().toISOString(),
      expires_at: offerExpiry(show.date),
      fee_amount: details.feeAmount,
      currency: details.currency,
    })
    .select('token')
    .single()

  if (error || !offer) throw new Error(error?.message ?? 'Kunne ikke opprette tilbudet.')

  // Manuelt tilbud betyr at bookeren aktivt jobber med showet — la det gå ut
  // av draft slik at svar fra komikeren behandles av bookingflyten.
  await admin.from('shows').update({ status: 'booking' }).eq('id', showId).eq('status', 'draft')

  const baseUrl = publicAppUrl()
  await sendBookingOfferEmail({
    email: artist.email,
    full_name: artist.full_name,
    show_title: show.title,
    show_date: show.date,
    show_time: details.show_time,
    venue: details.venue,
    role_name: details.role_name,
    fee_label: details.fee_label,
    token: offer.token,
    response_url: `${baseUrl}/booking-offer/${offer.token}`,
  })

  return { offerId: offer.token, artistName: artist.full_name }
}
