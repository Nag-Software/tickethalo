import { createAdminClient } from '@/lib/supabase/admin'
import { type ClubReadiness, isClubPayoutReady } from '@/lib/stripe-connect'
import { osloDate, ticketSalesState } from '@/lib/ticket-sales'
import { type PublicTicketSalesState, toPublicTicketSalesState } from '@/lib/ticket-sales-display'
import type { Artist, Club, ConfirmedSpot, Show, ShowRequirement } from '@/types/database'

// Rene formateringsfunksjoner, flyttet ut så klientkomponentene kan bruke dem
// uten å dra denne modulen med seg. Se `lib/public-show-format.ts`.
export {
  formatShortDate,
  formatShowDate,
  formatShowTime,
  formatTicketPrice,
  remainingTickets,
  ticketFillPercent,
} from '@/lib/public-show-format'

type PublicShowRow = Pick<Show, 'id' | 'title' | 'slug' | 'description' | 'date' | 'start_time' | 'end_time' | 'venue_name' | 'venue_address' | 'capacity' | 'ticket_price' | 'currency' | 'ticket_url' | 'poster_url' | 'status' | 'club_id' | 'ticket_sales_closed_at' | 'deleted_at'>

export type PublicShow = PublicShowRow & {
  clubName: string | null
  clubSlug: string | null
  clubCity: string | null
  clubLogoUrl: string | null
  /** Selgeren av billetten. Klubben er arrangør — Tickethalo formidler. */
  clubLegalName: string | null
  clubOrgNumber: string | null
  soldTickets: number
  /**
   * Om billetten kan kjøpes nå, regnet ut på serveren da siden ble hentet.
   * Tar med pris og klubbens Stripe-oppsett, ikke bare salgsvinduet — se
   * `isPubliclySellable`. Knappen leser denne; checkout sjekker på nytt når
   * kjøperen trykker.
   */
  salesState: PublicTicketSalesState
}

export type PublicLineupItem = {
  spot: ConfirmedSpot
  artist: Pick<Artist, 'id' | 'full_name' | 'stage_name' | 'profile_image_url' | 'bio'> | null
  role: Pick<ShowRequirement, 'id' | 'role_name'> | null
}

/** `as const` er ikke pynt: supabase-js utleder radtypen fra selve strengen. */
const SHOW_COLUMNS =
  'id, title, slug, description, date, start_time, end_time, venue_name, venue_address, capacity, ticket_price, currency, ticket_url, poster_url, status, club_id, ticket_sales_closed_at, deleted_at' as const

/**
 * Det sidene viser om klubben, pluss feltene klarheten avhenger av. Klarhetsfeltene
 * brukes bare til salgsstatusen og sendes aldri videre til klienten.
 */
const CLUB_COLUMNS =
  'id, name, slug, city, logo_url, legal_name, org_number, support_email, stripe_account_id, charges_enabled, payouts_enabled, payout_schedule_interval' as const

type PublicClubRow = Pick<Club, 'id' | 'name' | 'slug' | 'city' | 'logo_url'> & ClubReadiness

// Arkiverte show står som `cancelled` og faller bort på statusfilteret alene.
// `deleted_at` sjekkes likevel i hver spørring: et slettet show skal ikke
// dukke opp igjen om noen en dag endrer statusen på raden for hånd.
//
// «I dag» er norsk dato, som i salgsreglene. UTC-datoen lot gårsdagens show
// bli stående i lista den første timen eller to etter midnatt.

export async function getUpcomingPublishedShows(limit?: number): Promise<PublicShow[]> {
  const db = createAdminClient()
  const today = osloDate()
  let query = db
    .from('shows')
    .select(SHOW_COLUMNS)
    .eq('status', 'published')
    .is('deleted_at', null)
    .gte('date', today)
    .order('date', { ascending: true })

  if (limit) query = query.limit(limit)

  const { data: shows } = await query
  return withTicketCounts(shows ?? [])
}

export async function getPublishedShowBySlug(slug: string): Promise<PublicShow | null> {
  const db = createAdminClient()
  const { data: show } = await db
    .from('shows')
    .select(SHOW_COLUMNS)
    .eq('slug', slug)
    .eq('status', 'published')
    .is('deleted_at', null)
    .single()

  if (!show) return null
  const [withCounts] = await withTicketCounts([show])
  return withCounts ?? null
}

/**
 * Showene på én klubbside: kommende først, og et kort tilbakeblikk under.
 * Tilbakeblikket er der for klubber som ikke har lagt ut noe nytt ennå — en
 * tom klubbside sier ingenting om klubben.
 */
export async function getClubShows(clubId: string, pastLimit = 6): Promise<{ upcoming: PublicShow[]; past: PublicShow[] }> {
  const db = createAdminClient()
  const today = osloDate()

  const [{ data: upcoming }, { data: past }] = await Promise.all([
    db
      .from('shows')
      .select(SHOW_COLUMNS)
      .eq('club_id', clubId)
      .eq('status', 'published')
      .is('deleted_at', null)
      .gte('date', today)
      .order('date', { ascending: true }),
    db
      .from('shows')
      .select(SHOW_COLUMNS)
      .eq('club_id', clubId)
      .in('status', ['published', 'completed'])
      .is('deleted_at', null)
      .lt('date', today)
      .order('date', { ascending: false })
      .limit(pastLimit),
  ])

  const [upcomingWithCounts, pastWithCounts] = await Promise.all([
    withTicketCounts(upcoming ?? []),
    withTicketCounts(past ?? []),
  ])

  return { upcoming: upcomingWithCounts, past: pastWithCounts }
}

export async function getPublicLineup(showId: string): Promise<PublicLineupItem[]> {
  const db = createAdminClient()
  const { data: spots } = await db
    .from('confirmed_spots')
    .select('*')
    .eq('show_id', showId)
    .eq('status', 'confirmed')
    .order('confirmed_at', { ascending: true })

  const artistIds = [...new Set((spots ?? []).map((spot) => spot.artist_id))]
  const requirementIds = [...new Set((spots ?? []).map((spot) => spot.show_requirement_id))]
  const [{ data: artists }, { data: roles }] = await Promise.all([
    artistIds.length
      ? db.from('artists').select('id, full_name, stage_name, profile_image_url, bio').in('id', artistIds)
      : Promise.resolve({ data: [] as Array<Pick<Artist, 'id' | 'full_name' | 'stage_name' | 'profile_image_url' | 'bio'>> }),
    requirementIds.length
      ? db.from('show_requirements').select('id, role_name').in('id', requirementIds)
      : Promise.resolve({ data: [] as Array<Pick<ShowRequirement, 'id' | 'role_name'>> }),
  ])
  const artistMap = new Map((artists ?? []).map((artist) => [artist.id, artist]))
  const roleMap = new Map((roles ?? []).map((role) => [role.id, role]))

  return (spots ?? []).map((spot) => ({
    spot,
    artist: artistMap.get(spot.artist_id) ?? null,
    role: roleMap.get(spot.show_requirement_id) ?? null,
  }))
}

/**
 * Om et kjøp av showet kan gå gjennom checkout, utover salgsvinduet.
 *
 * Salgsvinduet alene sa «åpent» også når checkout uansett ville avvist kjøpet:
 * uten pris (`price_missing`), eller for en klubb som ikke er klar for salg
 * (`club_not_payable`). Kjøperen fylte da ut navn for å få en feil. Et show med
 * ekstern billettside går utenom Stripe (`app/events/actions.ts`), og da er det
 * bare salgsvinduet som gjelder.
 *
 * Ukjent utbetalingsplan (null) teller som klar her. Checkout henter planen
 * fra Stripe før den avgjør (`ensureClubPayoutScheduleKnown`), så klubber fra
 * før planen ble lagret retter seg selv ved første kjøp — mens en plan Stripe
 * har bekreftet som noe annet enn `manual`, stenger. Alt annet i klarheten
 * vurderes likt med checkout, fra samme funksjon.
 */
export function isPubliclySellable(
  show: Pick<Show, 'ticket_url' | 'ticket_price'>,
  club: ClubReadiness | null | undefined,
): boolean {
  if (show.ticket_url) return true
  if (!show.ticket_price || show.ticket_price <= 0) return false
  if (!club) return false
  return isClubPayoutReady({ ...club, payout_schedule_interval: club.payout_schedule_interval ?? 'manual' })
}

/**
 * Fyller på klubbnavn, antall solgte billetter og salgsstatus.
 *
 * Klubber og billettall hentes i én runde hver, uansett hvor mange show lista
 * har. Billettallet kommer fra `show_ticket_counts` (migrasjon 031) — før dette
 * gjorde funksjonen én count-spørring per show, altså tjue kall for en
 * forside med tjue show.
 */
async function withTicketCounts(shows: PublicShowRow[]): Promise<PublicShow[]> {
  if (shows.length === 0) return []

  // Ett tidspunkt for hele lista, så to show med samme dato aldri kan havne på
  // hver sin side av midnatt.
  const now = new Date()

  const db = createAdminClient()
  const clubIds = [...new Set(shows.map((show) => show.club_id).filter((clubId): clubId is string => Boolean(clubId)))]
  const showIds = shows.map((show) => show.id)

  const [{ data: clubs }, { data: ticketCounts }] = await Promise.all([
    clubIds.length > 0
      ? db.from('clubs').select(CLUB_COLUMNS).in('id', clubIds)
      : Promise.resolve({ data: [] as PublicClubRow[] }),
    db.from('show_ticket_counts').select('show_id, sold_tickets').in('show_id', showIds),
  ])

  const clubMap = new Map((clubs ?? []).map((club) => [club.id, club]))
  const soldByShow = new Map((ticketCounts ?? []).map((row) => [row.show_id, row.sold_tickets]))

  return shows.map((show) => {
    const club = show.club_id ? clubMap.get(show.club_id) : null

    return {
      ...show,
      clubName: club?.name ?? null,
      clubSlug: club?.slug ?? null,
      clubCity: club?.city ?? null,
      clubLogoUrl: club?.logo_url ?? null,
      clubLegalName: club?.legal_name ?? null,
      clubOrgNumber: club?.org_number ?? null,
      soldTickets: soldByShow.get(show.id) ?? 0,
      salesState: toPublicTicketSalesState(ticketSalesState(show, now), isPubliclySellable(show, club)),
    }
  })
}