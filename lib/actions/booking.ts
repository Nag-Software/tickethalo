'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  sendBookingOfferEmail,
  sendBookingConfirmedEmail,
  sendSpotFilledEmail,
  sendSpotAvailableEmail,
} from '@/lib/email/mailer'
import { generateShowPoster } from '@/lib/actions/ai'
import { getPublicAppUrl } from '@/lib/app-url'
import { loadResolvedPosterContext } from '@/lib/poster-assets'
import { normalizeArtistRole } from '@/lib/artist-roles'
import {
  computeFinalScore,
  applyBookingFairnessFilters,
  expandCandidatesForDemand,
  getGlobalBookingCap,
  getRoleBookingCount,
  getRoleExpansionOptions,
  matchesHardRequirements,
  selectFallbackCandidates,
  strictFilter,
  autoBookingOfferExpiresAt,
  OFFER_BUDGET_STATUSES,
  buildShowBookingInvolvedSet,
  selectExcessSentOfferIdsToCancel,
  BOOKING_NEUTRAL_SCORE,
  type ClubBookingSettings,
  type ClubFairnessContext,
  type ScoringArtist,
  type ScoringRequirement,
} from '@/lib/booking-scoring'
import { buildClubFairnessContext, loadClubBookingSettings } from '@/lib/club-booking-settings'

const ACTIVE_BOOKING_STATUSES = ['booking'] as const
const REOPEN_BOOKING_STATUSES = ['booking', 'fullbooked', 'published'] as const

type ArtistRow = ScoringArtist & {
  email: string
  full_name: string
}

/** Per-club nivå/segments keyed by artist id. Empty arrays are ignored (fall back to global category). */
async function loadPerClubArtistSegments(
  admin: ReturnType<typeof createAdminClient>,
  clubId: string | null | undefined,
): Promise<Map<string, string[]>> {
  if (!clubId) return new Map()
  const { data } = await admin
    .from('artist_club_scores')
    .select('artist_id, categories')
    .eq('club_id', clubId)
  return new Map(
    (data ?? [])
      .filter((row): row is { artist_id: string; categories: string[] } => Array.isArray(row.categories) && row.categories.length > 0)
      .map(row => [row.artist_id, row.categories]),
  )
}

/**
 * Prepares fetched artist rows for the scoring engine: applies each club's
 * per-club nivå (falling back to the artist's self-declared category) and feeds
 * a neutral constant score so quality no longer differentiates candidates.
 */
function applyClubSegments<T extends ArtistRow>(rows: T[], segments: Map<string, string[]>): T[] {
  return rows.map(row => ({
    ...row,
    admin_score: BOOKING_NEUTRAL_SCORE,
    category: segments.get(row.id) ?? row.category,
  }))
}

type RequirementRow = ScoringRequirement & {
  id: string
  quantity: number
  booking_mode?: string
  compensation_type?: string | null
  compensation_amount?: number | null
}

function applyFairCapFilter<T extends ScoringArtist>(
  candidates: T[],
  roleName: string,
  fairnessContext: ClubFairnessContext,
  poolSize: number,
  rosterSize: number,
): T[] {
  return applyBookingFairnessFilters(candidates, roleName, fairnessContext, poolSize, rosterSize)
}

function sortCandidatesByScore(
  artists: ArtistRow[],
  roleName: string,
  config: ClubBookingSettings,
  availableSet: Set<string>,
  fairnessContext: ClubFairnessContext,
  totalRolePoolSize: number,
  rosterSize: number,
) {
  const poolContext = { eligiblePoolSize: Math.max(1, totalRolePoolSize) }
  const bookedCounts = [...fairnessContext.bookingCountByArtist.values()].filter(count => count > 0)
  const catchUpClub = bookedCounts.length > 0
    && bookedCounts.filter(count => count >= 2).length >= 3
    && Math.max(...bookedCounts) >= 4
  return [...artists].sort((a, b) => {
    const globalA = fairnessContext.bookingCountByArtist.get(a.id) ?? 0
    const globalB = fairnessContext.bookingCountByArtist.get(b.id) ?? 0
    if (globalA !== globalB) {
      return catchUpClub ? globalB - globalA : globalA - globalB
    }

    const countA = getRoleBookingCount(a.id, roleName, fairnessContext)
    const countB = getRoleBookingCount(b.id, roleName, fairnessContext)
    if (countA !== countB) {
      return catchUpClub ? countB - countA : countA - countB
    }

    if (globalA > 0) {
      const scoreA = a.admin_score ?? 0
      const scoreB = b.admin_score ?? 0
      if (scoreA !== scoreB) return scoreA - scoreB
    }

    return computeFinalScore(b, roleName, config, availableSet, fairnessContext, poolContext)
      - computeFinalScore(a, roleName, config, availableSet, fairnessContext, poolContext)
  })
}

function requirementRolePriority(roleName: string | null | undefined) {
  const role = normalizeArtistRole(roleName)
  if (role === 'konferansier') return 0
  if (role === 'headliner') return 1
  if (role === 'klubbspot') return 2
  if (role === 'stand-up') return 2
  if (role === 'open mic') return 3
  return 4
}

async function enforceCascadeOfferIntegrity(
  admin: ReturnType<typeof createAdminClient>,
  showId: string,
  keepPerRequirement: number,
) {
  const { data: sentOffers, error } = await admin
    .from('booking_offers')
    .select('id, show_requirement_id, sent_at')
    .eq('show_id', showId)
    .eq('status', 'sent')
    .not('show_requirement_id', 'is', null)

  if (error) throw new Error(error.message)

  const duplicateIds = selectExcessSentOfferIdsToCancel(sentOffers ?? [], keepPerRequirement)
  if (duplicateIds.length === 0) return

  const { error: updateError } = await admin
    .from('booking_offers')
    .update({ status: 'cancelled', responded_at: new Date().toISOString() })
    .in('id', duplicateIds)

  if (updateError) throw new Error(updateError.message)
}

async function countActiveSentOffers(
  admin: ReturnType<typeof createAdminClient>,
  requirementId: string,
) {
  const { count, error } = await admin
    .from('booking_offers')
    .select('*', { count: 'exact', head: true })
    .eq('show_requirement_id', requirementId)
    .eq('status', 'sent')

  if (error) throw new Error(error.message)
  return count ?? 0
}

/**
 * Book show: selects and sends offers for all unfilled requirements.
 *
 * Scoring (configurable via club_booking_settings):
 *   FinalScore = BaseScore × fairnessMultiplier × consecutiveMultiplier × dominanceMultiplier + underbookedBoost
 *
 * Cascade assignment:
 *   1. At most offers_per_wave active sent offers per requirement.
 *   2. At most offers_per_wave new offers per requirement per bookShow invocation.
 *   3. offers_per_slot caps total attempts (declined/expired/sent) per open slot over time.
 * Falls back to relaxed criteria only when no strict candidates remain for a requirement.
 */
export async function bookShow(showId: string) {
  const admin = createAdminClient()
  let offersCreated = 0
  let candidatesMatched = 0

  const { data: show, error: showError } = await admin
    .from('shows')
    .select('id, title, date, status, start_time, venue_name, venue_address, club_id, currency, created_at')
    .eq('id', showId)
    .single()
  if (showError || !show) throw new Error('Show not found')
  if (!ACTIVE_BOOKING_STATUSES.includes(show.status as (typeof ACTIVE_BOOKING_STATUSES)[number])) {
    return { offersCreated, candidatesMatched }
  }

  const clubName = show.club_id
    ? (await admin.from('clubs').select('name').eq('id', show.club_id).single()).data?.name ?? null
    : null

  const { data: requirements, error: reqError } = await admin
    .from('show_requirements')
    .select('*')
    .eq('show_id', showId)
    .order('lineup_position')
    .order('created_at')
  if (reqError) throw new Error(reqError.message)
  if (!requirements?.length) return { offersCreated, candidatesMatched }

  const [config, { data: availableRows }, { data: allArtistRows }, clubSegments] = await Promise.all([
    loadClubBookingSettings(admin, show.club_id),
    admin.from('artist_availability').select('artist_id').eq('available_date', show.date),
    admin.from('artists')
      .select('id, email, full_name, admin_score, admin_energy_level, gender, category')
      .eq('status', 'approved')
      .eq('is_flagged', false),
    loadPerClubArtistSegments(admin, show.club_id),
  ])

  await enforceCascadeOfferIntegrity(admin, showId, config.offers_per_wave)

  if (!allArtistRows?.length) return { offersCreated, candidatesMatched }
  const allArtists = applyClubSegments(allArtistRows as ArtistRow[], clubSegments)

  const availableSet = new Set((availableRows ?? []).map(r => r.artist_id))
  const fairnessContext = await buildClubFairnessContext(admin, show.club_id, {
    id: show.id,
    date: show.date,
    start_time: show.start_time,
    created_at: show.created_at ?? show.date,
  }, config)

  const [{ data: existingOffers }, { data: existingSpots }, { data: excludedArtists }] = await Promise.all([
    admin.from('booking_offers').select('id, artist_id, show_requirement_id, status').eq('show_id', showId).in('status', [...OFFER_BUDGET_STATUSES]),
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

  const alreadyInvolved = buildShowBookingInvolvedSet({
    offers: activeExistingOffers,
    confirmedSpotArtistIds: (existingSpots ?? []).map(s => s.artist_id),
    excludedArtistIds: [...excludedArtistIds],
  })

  const pendingOffersByRequirement = new Map<string, number>()
  const offersUsedByRequirement = new Map<string, number>()
  for (const offer of activeExistingOffers) {
    if (!offer.show_requirement_id) continue
    if (OFFER_BUDGET_STATUSES.includes(offer.status as (typeof OFFER_BUDGET_STATUSES)[number])) {
      offersUsedByRequirement.set(
        offer.show_requirement_id,
        (offersUsedByRequirement.get(offer.show_requirement_id) ?? 0) + 1,
      )
    }
    if (offer.status !== 'sent') continue
    pendingOffersByRequirement.set(
      offer.show_requirement_id,
      (pendingOffersByRequirement.get(offer.show_requirement_id) ?? 0) + 1,
    )
  }

  const reqEntries: Array<{
    req: NonNullable<typeof requirements>[number]
    slotsNeeded: number
    currentPendingOffers: number
    offersUsed: number
    initialStrictCount: number
    maxNewOffers: number
  }> = []

  for (const req of requirements) {
    if (req.booking_mode === 'manual') continue

    const { count: filled } = await admin
      .from('confirmed_spots')
      .select('*', { count: 'exact', head: true })
      .eq('show_requirement_id', req.id)
      .in('status', ['confirmed', 'completed', 'paid'])

    const slotsNeeded = req.quantity - (filled ?? 0)
    if (slotsNeeded <= 0) continue

    const offerBudget = slotsNeeded * config.offers_per_slot
    const offersUsed = offersUsedByRequirement.get(req.id) ?? 0
    const currentPendingOffers = pendingOffersByRequirement.get(req.id) ?? 0
    const maxNewOffers = Math.max(0, offerBudget - offersUsed)
    if (maxNewOffers <= 0 || currentPendingOffers >= config.offers_per_wave) continue

    const initialStrictCount = (allArtists as ArtistRow[]).filter(a => strictFilter(a, req, alreadyInvolved, config)).length
    reqEntries.push({ req, slotsNeeded, currentPendingOffers, offersUsed, initialStrictCount, maxNewOffers })
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
    const dedicatedPoolSize = (allArtists as ArtistRow[]).filter(a =>
      strictFilter(a, req, new Set(), config),
    ).length
    const demandRatio = fairnessContext.totalClubEvents / Math.max(1, dedicatedPoolSize)
    const filterOptions = getRoleExpansionOptions(req.role_name, demandRatio, dedicatedPoolSize)
    const hasRoleExpansion = Object.keys(filterOptions).length > 0

    const totalRolePoolSize = hasRoleExpansion
      ? (allArtists as ArtistRow[]).filter(a => strictFilter(a, req, new Set(), config, filterOptions)).length
      : dedicatedPoolSize

    let strictCandidates = (allArtists as ArtistRow[]).filter(a =>
      strictFilter(a, req, effectiveInvolved, config, filterOptions),
    )

    if (demandRatio >= 1.2 && (dedicatedPoolSize <= 12 || hasRoleExpansion)) {
      strictCandidates = expandCandidatesForDemand(allArtists as ArtistRow[], req, effectiveInvolved, config, filterOptions)
    }

    const globalCap = getGlobalBookingCap(fairnessContext.totalClubEvents, (allArtists as ArtistRow[]).length)
    const underGlobalCap = strictCandidates.filter(
      artist => (fairnessContext.bookingCountByArtist.get(artist.id) ?? 0) < globalCap,
    )
    if (underGlobalCap.length > 0) {
      strictCandidates = underGlobalCap
    }

    strictCandidates = applyFairCapFilter(
      strictCandidates,
      req.role_name,
      fairnessContext,
      Math.max(totalRolePoolSize, strictCandidates.length),
      (allArtists as ArtistRow[]).length,
    )

    let candidates = sortCandidatesByScore(
      strictCandidates,
      req.role_name,
      config,
      availableSet,
      fairnessContext,
      Math.max(totalRolePoolSize, strictCandidates.length),
      (allArtists as ArtistRow[]).length,
    ).slice(0, limit)

    if (candidates.length === 0 && fallbackLimit > 0) {
      candidates = selectFallbackCandidates(allArtists as ArtistRow[], req, effectiveInvolved, config, Math.min(limit, fallbackLimit))
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

  const cascadeEntries = [...reqEntries].sort((a, b) => {
    const rolePriority = requirementRolePriority(a.req.role_name) - requirementRolePriority(b.req.role_name)
    if (rolePriority !== 0) return rolePriority

    if ((a.initialStrictCount === 0) !== (b.initialStrictCount === 0)) {
      return a.initialStrictCount === 0 ? 1 : -1
    }

    return a.initialStrictCount - b.initialStrictCount
      || a.req.lineup_position - b.req.lineup_position
  })

  for (const entry of cascadeEntries) {
    const alreadyAssignedForReq = assignedByRequirement.get(entry.req.id) ?? 0
    const remainingForReq = entry.maxNewOffers - alreadyAssignedForReq
    if (remainingForReq <= 0) continue

    const waveSize = Math.min(
      config.offers_per_wave - entry.currentPendingOffers - alreadyAssignedForReq,
      remainingForReq,
    )
    if (waveSize <= 0) continue

    const fallbackRemaining = Math.max(0, config.fallback_limit - entry.offersUsed - alreadyAssignedForReq)
    const candidates = chooseCandidates(entry.req, waveSize, fallbackRemaining)
    assignCandidates(entry.req, candidates)
  }

  candidatesMatched = assignments.length
  if (!assignments.length) return { offersCreated, candidatesMatched }

  const baseUrl = getPublicAppUrl()
  for (const { artistId, req } of assignments) {
    if (await countActiveSentOffers(admin, req.id) >= config.offers_per_wave) continue

    const artist = (allArtists as ArtistRow[]).find(a => a.id === artistId)!
    const feeAmountOere = req.compensation_type === 'fixed' && req.compensation_amount
      ? Math.round(Number(req.compensation_amount) * 100)
      : null
    const currency = show.currency ?? 'NOK'
    const { data: offer, error: offerError } = await admin
      .from('booking_offers')
      .insert({
        show_id: showId,
        artist_id: artist.id,
        show_requirement_id: req.id,
        status: 'sent',
        sent_at: new Date().toISOString(),
        expires_at: autoBookingOfferExpiresAt(),
        ...(feeAmountOere ? { fee_amount: feeAmountOere, currency } : {}),
      })
      .select('token')
      .single()

    if (offerError) {
      // Unique index: one sent offer per requirement (concurrent bookShow race).
      if (offerError.code === '23505') continue
      continue
    }
    if (!offer) continue
    offersCreated++

    await sendBookingOfferEmail({
      email: artist.email,
      full_name: artist.full_name,
      show_title: show.title,
      show_date: show.date,
      show_start_time: show.start_time,
      club_name: clubName,
      spot_type: req.role_name,
      venue_name: show.venue_name,
      venue_address: show.venue_address,
      fee_amount: feeAmountOere,
      currency,
      token: offer.token,
      response_url: `${baseUrl}/booking-offer/${offer.token}`,
    })
  }

  return { offersCreated, candidatesMatched }
}

/**
 * Expire sent offers past their deadline and cascade to the next candidate.
 * Intended to run on a schedule (e.g. hourly cron).
 */
export async function expireStaleBookingOffers() {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: staleOffers, error } = await admin
    .from('booking_offers')
    .select('id, show_id')
    .eq('status', 'sent')
    .lt('expires_at', now)

  if (error) throw new Error(error.message)
  if (!staleOffers?.length) return { expired: 0, showsProcessed: 0 }

  const offerIds = staleOffers.map(offer => offer.id)
  const { error: updateError } = await admin
    .from('booking_offers')
    .update({ status: 'expired', responded_at: now })
    .in('id', offerIds)

  if (updateError) throw new Error(updateError.message)

  const showIds = [...new Set(staleOffers.map(offer => offer.show_id))]
  for (const showId of showIds) {
    await runAutomaticBookingForShow(showId)
  }

  return { expired: offerIds.length, showsProcessed: showIds.length }
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

export async function automateFullbookedShow(showId: string) {
  const admin = createAdminClient()

  const { data: requirements } = await admin
    .from('show_requirements')
    .select('id, role_name, quantity')
    .eq('show_id', showId)

  if (!requirements?.length) return { fullbooked: false, reason: 'no_requirements' as const }

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

  const { data: show } = await admin
    .from('shows')
    .select('title, slug, date, start_time, venue_name, venue_address, poster_url, published_at, selected_marketing_design_id, poster_mode')
    .eq('id', showId)
    .single()

  if (!show) return { fullbooked: false, reason: 'show_not_found' as const }

  const { data: spots } = await admin
    .from('confirmed_spots')
    .select('artist_id, show_requirement_id')
    .eq('show_id', showId)
    .in('status', ['confirmed', 'completed', 'paid'])

  const artistIds = [...new Set((spots ?? []).map((spot) => spot.artist_id))]
  const { data: artistRows } = artistIds.length > 0
    ? await admin.from('artists').select('id, full_name, stage_name, profile_image_url').in('id', artistIds)
    : { data: [] as Array<{ id: string; full_name: string; stage_name: string | null; profile_image_url: string | null }> }
  const artistById = new Map((artistRows ?? []).map((artist) => [artist.id, artist]))
  const requirementById = new Map((requirements ?? []).map((requirement) => [requirement.id, requirement.role_name]))

  let posterUrl = show.poster_url ?? null

  const posterContext = await loadResolvedPosterContext(showId)

  posterUrl = await generateShowPoster(showId, {
    mode: posterContext.mode,
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
    aiReference: posterContext.aiReference,
    frameBackground: posterContext.frameBackground,
    aiReferenceSource: posterContext.aiReferenceSource,
  }) ?? show.poster_url ?? null

  const alreadyPublished = Boolean(show.published_at)
  const publishedAt = show.published_at ?? new Date().toISOString()

  // Publish show and set poster. Transitions from any pre-published status.
  await admin.from('shows').update({
    status: 'published',
    published_at: publishedAt,
    ...(posterUrl ? { poster_url: posterUrl } : {}),
  }).eq('id', showId).in('status', ['draft', 'booking', 'fullbooked'])

  // If already published, still keep poster in sync without touching status/published_at
  if (posterUrl && alreadyPublished) {
    await admin.from('shows').update({ poster_url: posterUrl })
      .eq('id', showId).eq('status', 'published')
  }

  return { fullbooked: true, posterUrl, published: true, publishedAt }
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
    const [{ data: artist }, { data: show }] = await Promise.all([
      admin.from('artists').select('email, full_name').eq('id', accepted.artist_id).single(),
      admin.from('shows').select('date, title, club_id').eq('id', accepted.show_id).single(),
    ])

    const clubName = show?.club_id
      ? (await admin.from('clubs').select('name').eq('id', show.club_id).single()).data?.name ?? show.title
      : show?.title ?? 'klubben'

    if (artist && show?.date) {
      await sendSpotFilledEmail({
        email: artist.email,
        full_name: artist.full_name,
        club_name: clubName ?? 'klubben',
        show_date: show.date,
      })
    }
  }

  if (accepted.should_notify && accepted.result === 'accepted') {
    const [{ data: artist }, { data: show }, { data: offer }] = await Promise.all([
      admin.from('artists').select('email, full_name').eq('id', accepted.artist_id).single(),
      admin.from('shows').select('title, date, venue_name, venue_address, club_id').eq('id', accepted.show_id).single(),
      admin.from('booking_offers').select('fee_amount, currency, show_requirement_id').eq('id', accepted.offer_id).single(),
    ])

    const clubName = show?.club_id
      ? (await admin.from('clubs').select('name').eq('id', show.club_id).single()).data?.name ?? show.title
      : show?.title ?? 'klubben'

    const { data: requirement } = offer?.show_requirement_id
      ? await admin
        .from('show_requirements')
        .select('role_name, compensation_type, compensation_amount, compensation_percent')
        .eq('id', offer.show_requirement_id)
        .single()
      : { data: null }

    if (artist && show?.date) {
      await sendBookingConfirmedEmail({
        email: artist.email,
        full_name: artist.full_name,
        club_name: clubName ?? 'klubben',
        venue_name: show.venue_name,
        venue_address: show.venue_address,
        show_date: show.date,
        spot_type: requirement?.role_name,
        fee_amount: offer?.fee_amount,
        currency: offer?.currency,
        compensation_type: requirement?.compensation_type,
        compensation_amount: requirement?.compensation_amount,
        compensation_percent: requirement?.compensation_percent,
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
      .update({ status: 'cancelled', responded_at: new Date().toISOString() })
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

  const [{ data: show }, { data: artist }, { data: requirement }] = await Promise.all([
    admin.from('shows').select('id, title, date, start_time, venue_name, venue_address, club_id').eq('id', showId).single(),
    admin.from('artists').select('id, email, full_name').eq('id', artistId).single(),
    admin.from('show_requirements').select('role_name').eq('id', requirementId).single(),
  ])

  if (!show || !artist) throw new Error('Show eller artist ikke funnet')

  const clubName = show.club_id
    ? (await admin.from('clubs').select('name').eq('id', show.club_id).single()).data?.name ?? null
    : null

  const feeAmountOere = feeRaw ? Math.round(parseFloat(feeRaw) * 100) : null

  const { data: offer, error } = await admin
    .from('booking_offers')
    .insert({
      show_id: showId,
      artist_id: artistId,
      show_requirement_id: requirementId,
      status: 'sent',
      sent_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      ...(feeRaw ? { fee_amount: feeAmountOere, currency: 'NOK' } : {}),
    })
    .select('token')
    .single()

  if (error || !offer) throw new Error(error?.message ?? 'Kunne ikke opprette tilbud')

  await sendBookingOfferEmail({
    email: artist.email,
    full_name: artist.full_name,
    show_title: show.title,
    show_date: show.date,
    show_start_time: show.start_time,
    club_name: clubName,
    spot_type: requirement?.role_name,
    venue_name: show.venue_name,
    venue_address: show.venue_address,
    fee_amount: feeAmountOere,
    currency: 'NOK',
    token: offer.token,
    response_url: `${getPublicAppUrl()}/booking-offer/${offer.token}`,
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
    .select('show_id')
    .maybeSingle()

  if (error) throw new Error(error.message)
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
    admin.from('shows').select('id, title, date, status, start_time, club_id, created_at').eq('id', showId).single(),
    admin.from('show_requirements').select('*').eq('id', requirementId).single(),
  ])

  if (!show || !requirement) return
  if (requirement.booking_mode === 'manual') return
  if (!REOPEN_BOOKING_STATUSES.includes(show.status as (typeof REOPEN_BOOKING_STATUSES)[number])) return

  if (show.status !== 'booking') {
    await admin.from('shows').update({ status: 'booking' }).eq('id', showId).in('status', ['fullbooked', 'published'])
  }

  const { count: filled } = await admin
    .from('confirmed_spots')
    .select('*', { count: 'exact', head: true })
    .eq('show_requirement_id', requirementId)
    .in('status', ['confirmed', 'completed', 'paid'])

  if ((filled ?? 0) >= requirement.quantity) return

  const [config, { data: availableRows }, { data: allArtistRows }, clubSegments] = await Promise.all([
    loadClubBookingSettings(admin, show.club_id),
    admin.from('artist_availability').select('artist_id').eq('available_date', show.date),
    admin.from('artists')
      .select('id, email, full_name, admin_score, admin_energy_level, gender, category')
      .eq('status', 'approved')
      .eq('is_flagged', false),
    loadPerClubArtistSegments(admin, show.club_id),
  ])

  await enforceCascadeOfferIntegrity(admin, showId, config.offers_per_wave)

  if (!allArtistRows?.length) return
  const allArtists = applyClubSegments(allArtistRows as ArtistRow[], clubSegments)

  const availableSet = new Set((availableRows ?? []).map(r => r.artist_id))
  const fairnessContext = await buildClubFairnessContext(admin, show.club_id, {
    id: show.id,
    date: show.date,
    start_time: show.start_time,
    created_at: show.created_at ?? show.date,
  }, config)

  const [{ data: existingOffers }, { data: existingSpots }, { data: excludedArtists }] = await Promise.all([
    admin.from('booking_offers').select('artist_id, show_requirement_id, status').eq('show_id', showId).in('status', [...OFFER_BUDGET_STATUSES]),
    admin.from('confirmed_spots').select('artist_id').eq('show_id', showId).in('status', ['confirmed', 'completed', 'paid']),
    admin.from('show_artist_booking_exclusions').select('artist_id').eq('show_id', showId),
  ])

  const slotsNeeded = requirement.quantity - (filled ?? 0)

  const currentPendingOffers = (existingOffers ?? []).filter(
    offer => offer.show_requirement_id === requirementId && offer.status === 'sent',
  ).length
  if (currentPendingOffers >= config.offers_per_wave) return

  const offersUsed = (existingOffers ?? []).filter(
    offer => offer.show_requirement_id === requirementId
      && OFFER_BUDGET_STATUSES.includes(offer.status as (typeof OFFER_BUDGET_STATUSES)[number]),
  ).length
  const offerBudget = slotsNeeded * config.offers_per_slot
  if (offersUsed >= offerBudget) return

  const alreadyInvolved = buildShowBookingInvolvedSet({
    offers: existingOffers ?? [],
    confirmedSpotArtistIds: (existingSpots ?? []).map(s => s.artist_id),
    excludedArtistIds: (excludedArtists ?? []).map(row => row.artist_id),
  })

  const rosterSize = (allArtists as ArtistRow[]).length
  const dedicatedPoolSize = (allArtists as ArtistRow[]).filter(a =>
    strictFilter(a, requirement, new Set(), config),
  ).length
  const demandRatio = fairnessContext.totalClubEvents / Math.max(1, dedicatedPoolSize)
  const filterOptions = getRoleExpansionOptions(requirement.role_name, demandRatio, dedicatedPoolSize)
  const hasRoleExpansion = Object.keys(filterOptions).length > 0
  const totalRolePoolSize = hasRoleExpansion
    ? (allArtists as ArtistRow[]).filter(a => strictFilter(a, requirement, new Set(), config, filterOptions)).length
    : dedicatedPoolSize

  let strictCandidates = (allArtists as ArtistRow[]).filter(a =>
    strictFilter(a, requirement, alreadyInvolved, config, filterOptions),
  )
  if (demandRatio >= 1.2 && (dedicatedPoolSize <= 12 || hasRoleExpansion)) {
    strictCandidates = expandCandidatesForDemand(allArtists as ArtistRow[], requirement, alreadyInvolved, config, filterOptions)
  }

  const globalCap = getGlobalBookingCap(fairnessContext.totalClubEvents, rosterSize)
  const underGlobalCap = strictCandidates.filter(
    artist => (fairnessContext.bookingCountByArtist.get(artist.id) ?? 0) < globalCap,
  )
  if (underGlobalCap.length > 0) {
    strictCandidates = underGlobalCap
  }

  strictCandidates = applyFairCapFilter(
    strictCandidates,
    requirement.role_name,
    fairnessContext,
    Math.max(totalRolePoolSize, strictCandidates.length),
    rosterSize,
  )

  const waveSize = Math.min(
    config.offers_per_wave - currentPendingOffers,
    offerBudget - offersUsed,
  )

  let candidates = sortCandidatesByScore(
    strictCandidates,
    requirement.role_name,
    config,
    availableSet,
    fairnessContext,
    Math.max(totalRolePoolSize, strictCandidates.length),
    rosterSize,
  ).slice(0, Math.max(0, waveSize))

  if (candidates.length === 0) {
    candidates = selectFallbackCandidates(
      allArtists as ArtistRow[],
      requirement,
      alreadyInvolved,
      config,
      Math.min(Math.max(0, waveSize), config.fallback_limit),
    )
  }

  const baseUrl = getPublicAppUrl()
  for (const artist of candidates) {
    if (await countActiveSentOffers(admin, requirementId) >= config.offers_per_wave) break

    const { data: offer, error } = await admin
      .from('booking_offers')
      .insert({
        show_id: showId,
        artist_id: artist.id,
        show_requirement_id: requirementId,
        status: 'sent',
        sent_at: new Date().toISOString(),
        expires_at: autoBookingOfferExpiresAt(),
      })
      .select('token')
      .single()

    if (error) {
      if (error.code === '23505') break
      continue
    }
    if (!offer) continue

    await sendSpotAvailableEmail({
      email: artist.email,
      full_name: artist.full_name,
      show_title: show.title,
      show_date: show.date,
      token: offer.token,
      response_url: `${baseUrl}/booking-offer/${offer.token}`,
    })
  }
}

