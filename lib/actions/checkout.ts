'use server'

import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'
import {
  CLUB_CONNECT_FIELDS,
  type ConnectClub,
  commissionFor,
  ensureClubPayoutScheduleKnown,
  isClubPayoutReady,
} from '@/lib/stripe-connect'
import {
  CheckoutError,
  checkoutErrorForSalesState,
  isMissingStripeResource,
  toCheckoutError,
} from '@/lib/checkout/errors'
import { ticketSalesState } from '@/lib/ticket-sales'
import { isTicketPriceBelowMinimum } from '@/lib/tickets'
import { type OrderItemInput, type OrderLine, encodeItemMetadata, productName } from '@/lib/ticket-types'
import { type TypeForCheckout, resolveCheckoutLines } from '@/lib/checkout/lines'

type ShowForCheckout = {
  id: string
  title: string
  slug: string
  date: string
  currency: string
}

/**
 * Hvor lenge en påbegynt betaling kan fullføres, i sekunder.
 *
 * Stripes standard er 24 timer. Stenger bookeren salget, kunne en fane som
 * sto åpen fra i går da fortsatt betale — og slettes showet i mellomtiden,
 * må pengene refunderes fordi oppgjøret ikke kan gi billett. 30 minutter er
 * det korteste Stripe godtar, regnet fra når Stripe mottar forespørselen.
 *
 * Fristen regnes ut én gang, før kallet, men SDK-en sender samme forespørsel
 * på nytt når et forsøk henger (`timeout` og `maxNetworkRetries` i
 * `lib/stripe.ts`). To forsøk som hang til tidsavbruddet uten å nå Stripe,
 * gjør at det siste kommer fram nesten et minutt etter at fristen ble regnet
 * ut — og ligger fristen da ett sekund under grensen, avviser Stripe sesjonen
 * og kjøperen får en feil. Fem minutter dekker alle forsøkene med ventetid,
 * pluss klokkeforskjell, og tåler at tidsavbruddet settes opp igjen.
 */
const CHECKOUT_SESSION_TTL_SECONDS = 35 * 60

export type TicketOrderInput = {
  /** Antall per billettype. */
  items: OrderItemInput[]
  /** Koden kjøperen tastet inn for å låse opp en type. */
  promoCode?: string | null
  /** Kjøperen vil ha e-post om nye show fra klubben. */
  marketingOptIn?: boolean
}

/**
 * 6.8 Create Stripe Checkout Session
 *
 * Betalingen opprettes PÅ klubbens Connect-konto (direct charge): klubben er
 * selger av billetten, og pengene er klubbens fra betalingsøyeblikket.
 * Tickethalo tar formidlingsprovisjonen som `application_fee_amount` og rører
 * aldri resten. Se `lib/stripe-connect.ts`.
 *
 * Always throws `CheckoutError` — the caller turns the code into a message.
 */
export async function createCheckoutSession(showId: string, requestUrl: string, order: TicketOrderInput) {
  const admin = createAdminClient()

  const { data: show, error } = await admin
    .from('shows')
    .select('id, title, slug, date, start_time, end_time, currency, capacity, status, club_id, ticket_sales_closed_at, deleted_at')
    .eq('id', showId)
    .single()

  if (error || !show) throw new CheckoutError('show_not_found', { detail: error?.message, cause: error })

  // Publisert, ikke arkivert, ikke passert, ikke stengt av bookeren og innenfor
  // salgsvinduet på 90 dager. Reglene står i `lib/ticket-sales.ts` og ingen
  // andre steder. Den gamle datosjekken her brukte UTC-datoen, og slapp derfor
  // gjennom kjøp til gårsdagens show den første timen eller to etter midnatt —
  // betalinger oppgjøret så måtte avvise og refundere.
  const salesError = checkoutErrorForSalesState(
    ticketSalesState(show),
    [
      `status=${show.status}`,
      `date=${show.date}`,
      show.start_time && `start=${show.start_time}`,
      show.deleted_at && `deleted_at=${show.deleted_at}`,
    ]
      .filter(Boolean)
      .join(' '),
  )
  if (salesError) throw salesError

  const { lines, types } = await resolveCheckoutLines(show, order)
  if (lines.every((line) => line.unitAmount === 0)) {
    // Gratis kurver går utenom Stripe (`lib/checkout/free.ts`). Kommer en hit,
    // har kalleren valgt feil vei.
    throw new CheckoutError('unknown', { detail: `free cart for show ${show.id} sent to Stripe checkout` })
  }
  // Skjemaet slipper ikke inn en pris under minsteprisen, men typer fra før
  // grensen kan ha en. Stripe ville avvist de laveste uansett (under 3 kr).
  const tooLow = lines.find((line) => line.unitAmount > 0 && isTicketPriceBelowMinimum(line.unitAmount))
  if (tooLow) {
    throw new CheckoutError('price_missing', { detail: `type ${tooLow.typeId} price=${tooLow.unitAmount} is below the minimum` })
  }

  // Klubber fra før migrasjon 047 har ingen kjent utbetalingsplan. Uten dette
  // ville hver av dem vært «ikke klar» til noen trykket Oppdater under Økonomi
  // — mens de offentlige sidene viser Kjøp. Oppslaget skjer bare mens planen er
  // ukjent, og en Stripe-feil gir bare klubben tilbake uendret.
  const loadedClub = await loadClub(show.club_id)
  const club = loadedClub ? await ensureClubPayoutScheduleKnown(loadedClub) : null
  const clubDetail = club
    ? `club=${club.id} charges=${club.charges_enabled} payouts=${club.payouts_enabled} ` +
      `schedule=${club.payout_schedule_interval ?? 'unknown'} org=${Boolean(club.org_number)}`
    : `show ${show.id} has no club`

  if (!isClubPayoutReady(club)) {
    throw new CheckoutError('club_not_payable', { detail: clubDetail })
  }

  // Garantert av `isClubPayoutReady` — kontoen er en del av det den sjekker.
  const account = club.stripe_account_id as string

  const origin = new URL(requestUrl).origin
  const typeMap = new Map(types.map((type) => [type.id, type]))
  const lineTypes = lines.map((line) => typeMap.get(line.typeId) as TypeForCheckout)
  const cached = lineTypes.filter((type) => type.stripe_product_id).map((type) => type.stripe_product_id as string)

  let productIds = await productsFor(show, lineTypes, types.length, account, false)
  let session: Stripe.Checkout.Session
  try {
    session = await createSession(show, club, lines, productIds, origin, order)
  } catch (sessionError) {
    // Produkt-ID-er hører til én Stripe-konto. Etter overgangen til Connect,
    // eller om klubben har koblet til en ny konto, er de lagrede ID-ene ukjente
    // for kontoen vi selger på. Lag produktene på nytt én gang før vi gir opp.
    if (!cached.some((productId) => isMissingStripeResource(sessionError, productId))) {
      throw toCheckoutError(sessionError)
    }

    console.warn(`[Checkout] Products for show ${show.id} are unknown to ${account} — creating replacements`)
    productIds = await productsFor(show, lineTypes, types.length, account, true)
    try {
      session = await createSession(show, club, lines, productIds, origin, order)
    } catch (retryError) {
      throw toCheckoutError(retryError)
    }
  }

  if (!session.url) throw new CheckoutError('unknown', { detail: `session ${session.id} has no url` })
  return { url: session.url, sessionId: session.id }
}

async function loadClub(clubId: string | null): Promise<ConnectClub | null> {
  if (!clubId) return null
  const admin = createAdminClient()
  const { data } = await admin.from('clubs').select(CLUB_CONNECT_FIELDS).eq('id', clubId).single()
  return (data as unknown as ConnectClub | null) ?? null
}

/**
 * Stripe-produktet per type, i samme rekkefølge som linjene. Lagres på typen
 * og gjenbrukes; `fresh` lager nye (kontoen kjente ikke de lagrede).
 *
 * Bare produktet gjenbrukes, aldri en pris. En lagret pris ble ikke laget på
 * nytt når bookeren endret billettprisen eller klubben byttet valuta: kjøperen
 * betalte den gamle prisen, mens provisjonen ble regnet av den nye — og klubben
 * satt igjen med noe annet enn 90 %. Beløpet settes nå i hver sesjon.
 */
async function productsFor(
  show: ShowForCheckout,
  types: TypeForCheckout[],
  typeCount: number,
  account: string,
  fresh: boolean,
): Promise<string[]> {
  return Promise.all(
    types.map((type) =>
      !fresh && type.stripe_product_id ? type.stripe_product_id : createProduct(show, type, typeCount, account),
    ),
  )
}

async function createProduct(show: ShowForCheckout, type: TypeForCheckout, typeCount: number, account: string) {
  let product: Stripe.Product
  try {
    product = await stripe.products.create(
      {
        // Stripe tar 250 tegn i navnet.
        name: productName(show.title, type.name, typeCount).slice(0, 250),
        metadata: { show_id: show.id, event_slug: show.slug, ticket_type_id: type.id },
      },
      { stripeAccount: account },
    )
  } catch (error) {
    throw toCheckoutError(error)
  }

  // Ikke kastet: produktet virker for denne sesjonen uansett. Mislykkes
  // lagringen, lages bare et nytt produkt ved neste kjøp.
  const { error } = await createAdminClient()
    .from('show_ticket_types')
    .update({ stripe_product_id: product.id })
    .eq('id', type.id)
  if (error) console.warn(`[Checkout] Could not store product ${product.id} for ticket type ${type.id}: ${error.message}`)

  return product.id
}

function createSession(
  show: ShowForCheckout,
  club: ConnectClub,
  lines: OrderLine[],
  productIds: string[],
  origin: string,
  order: TicketOrderInput,
) {
  // Beløpene og provisjonen regnes av de samme linjene i samme kall. Da kan
  // kjøperen aldri belastes en annen pris enn den provisjonen er regnet av,
  // og klubben sitter alltid igjen med nøyaktig sin andel. Provisjonen
  // regnes av prisen kjøperen betaler etter typens rabatt.
  const fees = lines.map((line) => commissionFor(line.unitAmount, club) * line.quantity)
  const commission = fees.reduce((sum, fee) => sum + fee, 0)
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0)
  // Regnes her og ikke hos kalleren: prøves sesjonen på nytt med nye
  // produkter, skal fristen gjelde fra det nye forsøket.
  const expiresAt = Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS
  const cartParam = lines.map((line) => `${line.typeId}:${line.quantity}`).join(',')

  return stripe.checkout.sessions.create(
    {
      mode: 'payment',
      // Én linje per type. Gratis typer i en kurv med betalte går med som
      // linjer på 0, så kjøperen ser hele bestillingen hos Stripe.
      line_items: lines.map((line, index) => ({
        quantity: line.quantity,
        price_data: {
          currency: show.currency.toLowerCase(),
          unit_amount: line.unitAmount,
          product: productIds[index],
        },
      })),
      // Telefonen lagres på ordren og kunden. Navn og e-post kommer også herfra.
      phone_number_collection: { enabled: true },
      expires_at: expiresAt,
      // `s` lar suksesssiden finne fram til riktig Connect-konto. Sesjonen
      // finnes bare på klubbens konto, så uten den kan den ikke hentes.
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}&s=${show.id}`,
      // `items` lar avbruddssiden tilby den samme kurven på nytt.
      cancel_url: `${origin}/checkout/cancel?event=${show.slug}&items=${encodeURIComponent(cartParam)}`,
      metadata: {
        show_id: show.id,
        // Stripe tar 500 tegn per verdi; tittelen har ingen grense hos oss.
        show_title: show.title.slice(0, 500),
        show_date: show.date,
        event_slug: show.slug,
        app_origin: origin,
        club_id: club.id,
        connected_account_id: club.stripe_account_id ?? '',
        quantity: String(quantity),
        // Provisjonen for hele ordren, i minste valutaenhet. Oppgjøret faller
        // tilbake på denne når betalingen ikke kan leses fra Stripe — ellers
        // ville ordren stått uten klubbens andel, og klubben aldri fått den utbetalt.
        application_fee_amount: String(commission),
        marketing_opt_in: order.marketingOptIn ? '1' : '0',
        // Linjene, én nøkkel per type — se `encodeItemMetadata`.
        ...encodeItemMetadata(
          lines.map((line, index) => ({
            typeId: line.typeId,
            quantity: line.quantity,
            unitAmount: line.unitAmount,
            platformFeeAmount: fees[index],
          })),
        ),
      },
      payment_intent_data: {
        // Formidlingsprovisjonen. Resten blir stående på klubbens konto.
        application_fee_amount: commission,
        metadata: {
          show_id: show.id,
          event_slug: show.slug,
          club_id: club.id,
        },
      },
      // Stripes egne rabattkoder er av. Provisjonen regnes av prisen når
      // sesjonen lages og følger ikke en Stripe-rabatt: en kode på 100 % gir
      // «no_payment_required» som oppgjøret avviser som ubetalt, og en kode
      // over 90 % gir en provisjon større enn beløpet. Rabatter ligger på
      // billettypen i stedet, og er med i prisen provisjonen regnes av.
      allow_promotion_codes: false,
    },
    { stripeAccount: club.stripe_account_id! },
  )
}
