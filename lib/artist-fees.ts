import { createAdminClient } from '@/lib/supabase/admin'
import { sendArtistFeeEmail } from '@/lib/email/mailer'
import { requirementFeeLabel } from '@/lib/booking-spots'
import { clubInvoiceRecipient, feeInvoiceUrl, issueFeeInvoice, syncFeeInvoiceAmount } from '@/lib/fee-invoices'
import type { ArtistFeeInvoice } from '@/types/database'
import type { ArtistFeeInvoiceStatus, RequirementCompensationType } from '@/types/database'

/**
 * Honoraret komikerne skal ha etter at showet er spilt.
 *
 * Grunnlaget er klubbens nettoinntekt på showet — `orders.club_net_amount`,
 * altså det klubben faktisk sitter igjen med etter provisjon og Stripe-gebyr
 * (se migrasjon 032). Av den går `clubs.artist_share_bps` (90 % som standard)
 * til lineupen; resten blir hos klubben.
 *
 * Hva den enkelte får står i lineupen, ikke her: fast beløp eller prosent på
 * `show_requirements`, satt da spoten ble booket. Denne modulen gjør bare to
 * ting med de avtalene — regner prosentene mot et salg som nå er kjent, og
 * passer på at summen ikke sprenger potten.
 *
 * Faste honorarer er avtalte kroner og skjæres ikke ned; det er en avtale
 * klubben har gjort uavhengig av hvor mange som kom. Er det taket sprenges
 * av, er det prosentandelene som skaleres — og selger showet så dårlig at de
 * faste alene overstiger potten, står klubben for mellomlegget.
 *
 * Utbetalingen skjer mot faktura, og fakturaen går til klubben. Derfor
 * skriver kjøringen et fakturagrunnlag med referanse for hvert honorar før
 * eposten sendes — se `lib/fee-invoices.ts`. Referansen er det klubben
 * kontrollerer innkommende fakturaer mot; uten grunnlag går det ingen epost.
 */

/** Honorarfeltene fra kravet spoten hører til. */
export type FeeArrangement = {
  compensation_type: RequirementCompensationType | null
  compensation_amount: number | null
  compensation_percent: number | null
}

export type FeeSpotInput = FeeArrangement & {
  spotId: string
  artistId: string
}

export type SpotFee = {
  spotId: string
  artistId: string
  /** Minste valutaenhet. */
  amount: number
  basis: 'fixed' | 'percent' | 'none'
  /** Prosenten avtalen står i, når den er en prosentavtale. */
  percent: number | null
  /** True når taket tvang beløpet ned fra det avtalen isolert ga. */
  capped: boolean
}

export type ShowFeeBreakdown = {
  /** Klubbens netto på showet. */
  net: number
  /** Andelen lineupen deler — `net` ganger klubbens sats. */
  pot: number
  fees: SpotFee[]
  /** Summen som faktisk deles ut. */
  total: number
  /** Faste honorarer alene oversteg potten. Da er det prisen som er feil. */
  overCommitted: boolean
}

/** Fordeler potten på spotene. Ren funksjon — ingen database, ingen epost. */
export function computeShowFees({
  net,
  shareBps,
  spots,
}: {
  net: number
  shareBps: number
  spots: FeeSpotInput[]
}): ShowFeeBreakdown {
  const pot = Math.max(0, Math.round((net * shareBps) / 10000))

  const raw = spots.map((spot): SpotFee => {
    if (spot.compensation_type === 'fixed') {
      return {
        spotId: spot.spotId,
        artistId: spot.artistId,
        amount: Math.max(0, spot.compensation_amount ?? 0),
        basis: 'fixed',
        percent: null,
        capped: false,
      }
    }

    if (spot.compensation_type === 'percent') {
      const percent = spot.compensation_percent ?? 0
      return {
        spotId: spot.spotId,
        artistId: spot.artistId,
        amount: Math.max(0, Math.round((net * percent) / 100)),
        basis: 'percent',
        percent,
        capped: false,
      }
    }

    // Ingen avtale er ikke det samme som null kroner — men uten et tall å
    // regne fra er null det eneste ærlige svaret kjøringen kan gi.
    return { spotId: spot.spotId, artistId: spot.artistId, amount: 0, basis: 'none', percent: null, capped: false }
  })

  const fixedTotal = raw.filter((fee) => fee.basis === 'fixed').reduce((sum, fee) => sum + fee.amount, 0)
  const percentTotal = raw.filter((fee) => fee.basis === 'percent').reduce((sum, fee) => sum + fee.amount, 0)
  const room = pot - fixedTotal

  const fees = raw.map((fee) => {
    if (fee.basis !== 'percent' || percentTotal <= room) return fee

    // Skalering ned, ikke avkorting av den siste: alle prosentavtaler tar
    // like stor del av nedskaleringen. Floor gjør at summen aldri kryper
    // over taket på grunn av avrunding.
    const scaled = room <= 0 ? 0 : Math.floor((fee.amount * room) / percentTotal)
    return { ...fee, amount: scaled, capped: true }
  })

  return {
    net,
    pot,
    fees,
    total: fees.reduce((sum, fee) => sum + fee.amount, 0),
    overCommitted: fixedTotal > pot,
  }
}

type ShowRow = {
  id: string
  title: string
  date: string
  currency: string
  status: string
  club_id: string | null
  venue_name: string | null
}

export type ShowFeeOutcome = {
  showId: string
  showTitle: string
  net: number
  paid: number
  emailed: number
  /** Komikere uten kontonummer i profilen. Eposten går ut uansett. */
  missingAccount: number
  skipped?: string
}

/** Klubbens netto på showet — samme hovedbok som økonomisiden leser. */
async function showNetRevenue(showId: string): Promise<number> {
  const db = createAdminClient()

  // Refunderte ordrer teller ikke: pengene er tilbake hos kjøperen, og da er
  // de heller ikke grunnlag for honorar.
  const { data: orders } = await db
    .from('orders')
    .select('club_net_amount')
    .eq('show_id', showId)
    .eq('status', 'paid')

  return (orders ?? []).reduce((total, order) => total + (order.club_net_amount ?? 0), 0)
}

async function settleShow(show: ShowRow): Promise<ShowFeeOutcome> {
  const db = createAdminClient()
  const base = { showId: show.id, showTitle: show.title, net: 0, paid: 0, emailed: 0, missingAccount: 0 }

  if (!show.club_id) return { ...base, skipped: 'no club on show' }

  const { data: club } = await db
    .from('clubs')
    .select('id, name, artist_share_bps, legal_name, org_number, invoice_email, support_email')
    .eq('id', show.club_id)
    .single()

  if (!club) return { ...base, skipped: 'club not found' }

  const { data: spotRows } = await db
    .from('confirmed_spots')
    .select('id, artist_id, show_requirement_id, fee_email_sent_at')
    .eq('show_id', show.id)
    .in('status', ['confirmed', 'completed', 'paid'])

  const spots = spotRows ?? []
  if (spots.length === 0) {
    await markCompleted(show)
    return { ...base, skipped: 'no booked spots' }
  }

  // Klubben er den komikeren fakturerer. Mangler fakturaadressen, går
  // grunnlaget ut likevel — beløpet er riktig, og en komiker som vet hva
  // han skal ha er bedre stilt enn en som venter på at klubben fyller ut et
  // felt. Eposten sier hva som mangler, og advarselen her sier det til oss.
  const recipient = clubInvoiceRecipient(club)
  if (!recipient.email) {
    console.warn(`[ArtistFees] ${show.id}: klubben ${club.name} har ingen fakturaadresse`)
  }

  const { data: requirements } = await db
    .from('show_requirements')
    .select('id, compensation_type, compensation_amount, compensation_percent')
    .eq('show_id', show.id)

  const arrangements = new Map((requirements ?? []).map((row) => [row.id, row as FeeArrangement & { id: string }]))

  const net = await showNetRevenue(show.id)
  const breakdown = computeShowFees({
    net,
    shareBps: club.artist_share_bps,
    spots: spots.map((spot) => {
      const arrangement = arrangements.get(spot.show_requirement_id)
      return {
        spotId: spot.id,
        artistId: spot.artist_id,
        compensation_type: arrangement?.compensation_type ?? null,
        compensation_amount: arrangement?.compensation_amount ?? null,
        compensation_percent: arrangement?.compensation_percent ?? null,
      }
    }),
  })

  const artistIds = [...new Set(spots.map((spot) => spot.artist_id))]
  const { data: artistRows } = await db
    .from('artists')
    .select('id, full_name, email, bank_account_number')
    .in('id', artistIds)

  const artists = new Map((artistRows ?? []).map((artist) => [artist.id, artist]))
  const alreadySent = new Set(spots.filter((spot) => spot.fee_email_sent_at).map((spot) => spot.id))

  let emailed = 0
  let missingAccount = 0

  for (const fee of breakdown.fees) {
    const spot = spots.find((row) => row.id === fee.spotId)
    const arrangement = spot ? arrangements.get(spot.show_requirement_id) : undefined
    const agreement = arrangement ? requirementFeeLabel(arrangement, show.currency) : null

    // Beløpet skrives uansett — komikerportalen skal vise det samme tallet
    // som eposten, også for spots som allerede er varslet.
    await db
      .from('confirmed_spots')
      .update({ fee_amount: fee.amount, currency: show.currency, status: 'completed' })
      .eq('id', fee.spotId)

    if (alreadySent.has(fee.spotId)) {
      if (fee.amount <= 0) {
        const existing = await syncFeeInvoiceAmount({
          spotId: fee.spotId,
          amount: fee.amount,
          currency: show.currency,
          agreement,
        })

        if (existing) {
          console.warn(
            `[ArtistFees] ${show.id}/${fee.spotId}: honoraret er falt til 0 etter at ${existing.reference} gikk ut`,
          )
        }
        continue
      }

      // Grunnlaget mangler for honorarer som ble varslet før referansene
      // fantes. Det lages her, slik at kravet blir mulig å kontrollere i det
      // hele tatt — komikeren får referansen når klubben sender grunnlaget på
      // nytt. Finnes raden alt, holder dette bare beløpet i takt med et salg
      // som kan ha endret seg etter utsendelsen.
      const artist = artists.get(fee.artistId)
      await issueFeeInvoice({
        spotId: fee.spotId,
        showId: show.id,
        artistId: fee.artistId,
        clubId: club.id,
        amount: fee.amount,
        currency: show.currency,
        agreement,
        bankAccountNumber: artist?.bank_account_number ?? null,
        artistEmail: artist?.email ?? null,
      })
      continue
    }

    // Null kroner er ingen utbetaling å varsle om. Salget står i portalen
    // for den som lurer på hvorfor.
    if (fee.amount <= 0) continue

    const artist = artists.get(fee.artistId)
    if (!artist?.email) continue

    if (!artist.bank_account_number) missingAccount += 1

    // Referansen først, eposten etterpå: en komiker skal aldri sitte med et
    // beløp vi ikke har et grunnlag for. Får vi ikke skrevet raden, går
    // eposten heller ikke ut — da tar kjøringen spoten i morgen.
    const invoice = await issueFeeInvoice({
      spotId: fee.spotId,
      showId: show.id,
      artistId: fee.artistId,
      clubId: club.id,
      amount: fee.amount,
      currency: show.currency,
      agreement,
      bankAccountNumber: artist.bank_account_number,
      artistEmail: artist.email,
    })

    if (!invoice) {
      console.error(`[ArtistFees] ${show.id}/${fee.spotId}: kunne ikke opprette fakturagrunnlag`)
      continue
    }

    const result = await sendArtistFeeEmail({
      email: artist.email,
      full_name: artist.full_name,
      show_title: show.title,
      show_date: show.date,
      amount: fee.amount,
      currency: show.currency,
      invoice_url: feeInvoiceUrl(invoice.token),
    })

    if (!result.success) {
      console.error(`[ArtistFees] ${show.id}/${fee.spotId}: ${result.error}`)
      continue
    }

    await db
      .from('confirmed_spots')
      .update({ fee_email_sent_at: new Date().toISOString() })
      .eq('id', fee.spotId)

    emailed += 1
  }

  await markCompleted(show)

  if (breakdown.overCommitted) {
    console.warn(
      `[ArtistFees] ${show.id}: faste honorarer (${breakdown.total}) overstiger potten (${breakdown.pot})`,
    )
  }

  return { ...base, net, paid: breakdown.total, emailed, missingAccount }
}

async function markCompleted(show: ShowRow) {
  if (show.status === 'completed') return
  await createAdminClient().from('shows').update({ status: 'completed' }).eq('id', show.id)
}

/**
 * Gjør opp alle show som er avholdt og ennå ikke gjort opp. Kjøres daglig,
 * så et show blir tatt dagen etter at det gikk.
 */
export async function settleFinishedShows(today = new Date()) {
  const db = createAdminClient()
  const todayDate = today.toISOString().slice(0, 10)

  // `completed` er med fordi et show kan ha blitt markert avholdt før
  // honorarene gikk ut — da skal kjøringen fortsatt plukke det opp.
  const { data: shows } = await db
    .from('shows')
    .select('id, title, date, currency, status, club_id, venue_name')
    .lt('date', todayDate)
    .in('status', ['published', 'fullbooked', 'completed'])

  const outcomes: ShowFeeOutcome[] = []

  for (const show of (shows ?? []) as ShowRow[]) {
    try {
      outcomes.push(await settleShow(show))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[ArtistFees] ${show.id}: ${message}`)
      outcomes.push({ showId: show.id, showTitle: show.title, net: 0, paid: 0, emailed: 0, missingAccount: 0, skipped: message })
    }
  }

  return {
    shows: outcomes.length,
    emailed: outcomes.reduce((total, outcome) => total + outcome.emailed, 0),
    paid: outcomes.reduce((total, outcome) => total + outcome.paid, 0),
    outcomes,
  }
}

// ─────────────────────────────────────────────────────────────
// Oversikten klubben betaler etter
// ─────────────────────────────────────────────────────────────

export type ArtistFeeLine = {
  artistId: string
  name: string
  /** Minste valutaenhet. */
  amount: number
  /** Avtalen slik den står i lineupen, f.eks. «80% of sales». */
  agreement: string
  accountNumber: string | null
  /** Fakturagrunnlaget er sendt til komikeren. */
  notified: boolean
  capped: boolean
  /** Referansen fakturaen skal merkes med, når grunnlaget er sendt. */
  reference: string | null
  /** Hvor langt fakturaen er kommet. Se `lib/fee-invoices.ts`. */
  invoiceStatus: ArtistFeeInvoiceStatus | null
}

export type ShowFeeSummary = {
  showId: string
  title: string
  date: string
  currency: string
  net: number
  pot: number
  total: number
  lines: ArtistFeeLine[]
  overCommitted: boolean
}

/**
 * Hva klubben skylder komikerne, samlet per avholdt show.
 *
 * Beløpene regnes her og nå i stedet for å leses fra `fee_amount`, slik at
 * oversikten stemmer også for et show som gikk i går kveld og ennå ikke er
 * plukket opp av kjøringen. Kjøringen skriver de samme tallene når den går —
 * begge sider bruker `computeShowFees`.
 *
 * Show uten bookede spots faller ut: de har ingen å betale, og lista er til
 * for å betale etter. Derfor hentes det flere show enn `limit` — grensen
 * gjelder show det faktisk står noen på.
 */
export async function getClubArtistFees(clubId: string, limit = 6): Promise<ShowFeeSummary[]> {
  const db = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: club } = await db.from('clubs').select('artist_share_bps').eq('id', clubId).single()
  if (!club) return []

  const { data: showRows } = await db
    .from('shows')
    .select('id, title, date, currency')
    .eq('club_id', clubId)
    .lt('date', today)
    .neq('status', 'cancelled')
    .order('date', { ascending: false })
    .limit(Math.min(limit * 5, 50))

  const shows = showRows ?? []
  if (shows.length === 0) return []

  const showIds = shows.map((show) => show.id)

  const [{ data: spotRows }, { data: requirementRows }, { data: orderRows }, { data: invoiceRows }] = await Promise.all([
    db
      .from('confirmed_spots')
      .select('id, show_id, artist_id, show_requirement_id, fee_email_sent_at')
      .in('show_id', showIds)
      .in('status', ['confirmed', 'completed', 'paid']),
    db
      .from('show_requirements')
      .select('id, show_id, compensation_type, compensation_amount, compensation_percent')
      .in('show_id', showIds),
    db
      .from('orders')
      .select('show_id, club_net_amount')
      .in('show_id', showIds)
      .eq('status', 'paid'),
    db
      .from('artist_fee_invoices')
      .select('spot_id, reference, status')
      .in('show_id', showIds),
  ])

  const spots = spotRows ?? []
  const arrangements = new Map((requirementRows ?? []).map((row) => [row.id, row as FeeArrangement & { id: string }]))
  const invoices = new Map((invoiceRows ?? []).map((row) => [row.spot_id, row]))

  const netByShow = new Map<string, number>()
  for (const order of orderRows ?? []) {
    if (!order.show_id) continue
    netByShow.set(order.show_id, (netByShow.get(order.show_id) ?? 0) + (order.club_net_amount ?? 0))
  }

  const artistIds = [...new Set(spots.map((spot) => spot.artist_id))]
  const { data: artistRows } = artistIds.length
    ? await db.from('artists').select('id, full_name, stage_name, bank_account_number').in('id', artistIds)
    : { data: [] as Array<{ id: string; full_name: string; stage_name: string | null; bank_account_number: string | null }> }

  const artists = new Map((artistRows ?? []).map((artist) => [artist.id, artist]))

  const withLineup = shows.filter((show) => spots.some((spot) => spot.show_id === show.id)).slice(0, limit)

  return withLineup.map((show) => {
    const showSpots = spots.filter((spot) => spot.show_id === show.id)
    const net = netByShow.get(show.id) ?? 0
    const breakdown = computeShowFees({
      net,
      shareBps: club.artist_share_bps,
      spots: showSpots.map((spot) => {
        const arrangement = arrangements.get(spot.show_requirement_id)
        return {
          spotId: spot.id,
          artistId: spot.artist_id,
          compensation_type: arrangement?.compensation_type ?? null,
          compensation_amount: arrangement?.compensation_amount ?? null,
          compensation_percent: arrangement?.compensation_percent ?? null,
        }
      }),
    })

    const lines = breakdown.fees.map((fee): ArtistFeeLine => {
      const spot = showSpots.find((row) => row.id === fee.spotId)
      const artist = artists.get(fee.artistId)
      const arrangement = spot ? arrangements.get(spot.show_requirement_id) : undefined
      const invoice = invoices.get(fee.spotId)

      return {
        artistId: fee.artistId,
        name: artist?.stage_name?.trim() || artist?.full_name || 'Unknown comedian',
        amount: fee.amount,
        agreement: arrangement
          ? requirementFeeLabel(arrangement, show.currency)
          : 'Not set',
        accountNumber: artist?.bank_account_number ?? null,
        notified: Boolean(spot?.fee_email_sent_at),
        capped: fee.capped,
        reference: invoice?.reference ?? null,
        invoiceStatus: (invoice?.status as ArtistFeeInvoiceStatus | undefined) ?? null,
      }
    })

    return {
      showId: show.id,
      title: show.title,
      date: show.date,
      currency: show.currency,
      net,
      pot: breakdown.pot,
      total: breakdown.total,
      lines,
      overCommitted: breakdown.overCommitted,
    }
  })
}

// ─────────────────────────────────────────────────────────────
// Sende grunnlaget på nytt
// ─────────────────────────────────────────────────────────────

/**
 * Sender honorar-eposten om igjen.
 *
 * Klubben trykker på den når komikeren ikke har fått eposten, har mistet den
 * eller har byttet adresse. Det er samme lenke og samme beløp — det er ikke et
 * nytt krav, det er det samme kravet en gang til.
 *
 * Alt som kan ha endret seg står på siden lenken peker til, og leses når den
 * åpnes. Derfor trenger denne funksjonen bare adressen å sende til, og den er
 * komikerens nåværende: har hun byttet epost i profilen, er det den nye som
 * skal få den. Grunnlaget beholder den gamle, fordi den forteller hvor det
 * opprinnelig gikk.
 */
export async function resendFeeInvoiceEmail({ invoiceId, clubId }: { invoiceId: string; clubId: string }) {
  const db = createAdminClient()

  const { data: invoiceRow } = await db
    .from('artist_fee_invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('club_id', clubId)
    .maybeSingle()

  const invoice = invoiceRow as ArtistFeeInvoice | null
  if (!invoice) throw new Error('Fant ikke fakturagrunnlaget.')

  const [{ data: artist }, { data: show }] = await Promise.all([
    db.from('artists').select('id, full_name, email').eq('id', invoice.artist_id).single(),
    db.from('shows').select('id, title, date').eq('id', invoice.show_id).single(),
  ])

  if (!artist?.email) throw new Error('Komikeren har ingen e-postadresse.')
  if (!show) throw new Error('Fant ikke showet.')

  const result = await sendArtistFeeEmail({
    email: artist.email,
    full_name: artist.full_name,
    show_title: show.title,
    show_date: show.date,
    amount: invoice.amount,
    currency: invoice.currency,
    invoice_url: feeInvoiceUrl(invoice.token),
  })

  if (!result.success) {
    console.error(`[ArtistFees] resend ${invoice.reference}: ${result.error}`)
    throw new Error('E-posten kunne ikke sendes. Prøv igjen om litt.')
  }

  const now = new Date().toISOString()
  await db
    .from('artist_fee_invoices')
    .update({ last_sent_at: now, send_count: invoice.send_count + 1, updated_at: now })
    .eq('id', invoice.id)

  // Var førstegangsutsendelsen den som feilet, står spoten fortsatt uten
  // stempel — og da ville kjøringen sendt den en gang til i natt.
  await db
    .from('confirmed_spots')
    .update({ fee_email_sent_at: now })
    .eq('id', invoice.spot_id)
    .is('fee_email_sent_at', null)

  return { reference: invoice.reference, email: artist.email, sendCount: invoice.send_count + 1 }
}
