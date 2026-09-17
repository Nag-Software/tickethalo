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
import { MAX_TICKETS_PER_ORDER } from '@/lib/tickets'

type ShowForCheckout = {
  id: string
  title: string
  slug: string
  date: string
  ticket_price: number | null
  currency: string
  stripe_product_id: string | null
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
  quantity: number
  /** Navn per billett, i samme rekkefølge. Kortere enn `quantity` er lov. */
  holderNames: string[]
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
export async function createCheckoutSession(
  showId: string,
  requestUrl: string,
  order: TicketOrderInput = { quantity: 1, holderNames: [] },
) {
  const admin = createAdminClient()
  const quantity = Math.min(Math.max(1, Math.floor(order.quantity || 1)), MAX_TICKETS_PER_ORDER)

  const { data: show, error } = await admin
    .from('shows')
    .select('id, title, slug, date, start_time, ticket_price, currency, stripe_product_id, capacity, status, club_id, ticket_sales_closed_at, deleted_at')
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

  if (!show.ticket_price || show.ticket_price <= 0) throw new CheckoutError('price_missing')

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

  // Check remaining capacity
  if (show.capacity !== null) {
    const { count: soldCount } = await admin
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('show_id', showId)
      .in('status', ['valid', 'used'])

    // Hele bestillingen må få plass — den samme regelen som oppgjøret
    // håndhever når betalingen kommer tilbake (migrasjon 036).
    if ((soldCount ?? 0) + quantity > show.capacity) {
      throw new CheckoutError('sold_out', { detail: `sold=${soldCount}/${show.capacity} wanted=${quantity}` })
    }
  }

  const origin = new URL(requestUrl).origin
  const cachedProductId = show.stripe_product_id
  const productId = cachedProductId ?? (await createProduct(show, account))

  let session: Stripe.Checkout.Session
  try {
    session = await createSession(show, club, productId, origin, quantity, order.holderNames)
  } catch (sessionError) {
    // Produkt-ID-er hører til én Stripe-konto. Etter overgangen til Connect,
    // eller om klubben har koblet til en ny konto, er den lagrede ID-en ukjent
    // for kontoen vi selger på. Lag produktet på nytt én gang før vi gir opp.
    if (!cachedProductId || !isMissingStripeResource(sessionError, productId)) {
      throw toCheckoutError(sessionError)
    }

    console.warn(`[Checkout] Product ${productId} for show ${show.id} is unknown to ${account} — creating a replacement`)
    const replacementId = await createProduct(show, account)
    try {
      session = await createSession(show, club, replacementId, origin, quantity, order.holderNames)
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
 * Lager produktet for showet på klubbens konto og husker ID-en på showet.
 *
 * Bare produktet gjenbrukes, aldri en pris. En lagret pris ble ikke laget på
 * nytt når bookeren endret billettprisen eller klubben byttet valuta: kjøperen
 * betalte den gamle prisen, mens provisjonen ble regnet av den nye — og klubben
 * satt igjen med noe annet enn 90 %. Beløpet settes nå i hver sesjon.
 */
async function createProduct(show: ShowForCheckout, account: string) {
  let product: Stripe.Product
  try {
    product = await stripe.products.create(
      {
        name: show.title,
        metadata: { show_id: show.id, event_slug: show.slug },
      },
      { stripeAccount: account },
    )
  } catch (error) {
    throw toCheckoutError(error)
  }

  // Ikke kastet: produktet virker for denne sesjonen uansett. Mislykkes
  // lagringen, lages bare et nytt produkt ved neste kjøp.
  const { error } = await createAdminClient()
    .from('shows')
    .update({ stripe_product_id: product.id })
    .eq('id', show.id)
  if (error) console.warn(`[Checkout] Could not store product ${product.id} for show ${show.id}: ${error.message}`)

  return product.id
}

function createSession(
  show: ShowForCheckout,
  club: ConnectClub,
  productId: string,
  origin: string,
  quantity: number,
  holderNames: string[],
) {
  // Beløpet og provisjonen leses av samme rad i samme kall. Da kan kjøperen
  // aldri belastes en annen pris enn den provisjonen er regnet av, og klubben
  // sitter alltid igjen med nøyaktig sin andel.
  const unitAmount = show.ticket_price!
  // Provisjonen er per billett, så den skal ganges opp med antallet.
  const commission = commissionFor(unitAmount, club) * quantity
  // Regnes her og ikke hos kalleren: prøves sesjonen på nytt med et nytt
  // produkt, skal fristen gjelde fra det nye forsøket.
  const expiresAt = Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS

  return stripe.checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          quantity,
          price_data: {
            currency: show.currency.toLowerCase(),
            unit_amount: unitAmount,
            product: productId,
          },
        },
      ],
      expires_at: expiresAt,
      // `s` lar suksesssiden finne fram til riktig Connect-konto. Sesjonen
      // finnes bare på klubbens konto, så uten den kan den ikke hentes.
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}&s=${show.id}`,
      cancel_url: `${origin}/checkout/cancel?event=${show.slug}`,
      metadata: {
        show_id: show.id,
        show_title: show.title,
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
        // Ett navn per nøkkel framfor én JSON-streng: Stripe tåler 50 nøkler
        // à 500 tegn, men en samlet streng ville sprengt grensen på lange navn.
        ...ticketNameMetadata(holderNames, quantity),
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
      allow_promotion_codes: true,
    },
    { stripeAccount: club.stripe_account_id! },
  )
}

/** `ticket_name_1` … `ticket_name_n`, tomme navn utelatt. */
function ticketNameMetadata(holderNames: string[], quantity: number) {
  const entries: Record<string, string> = {}

  for (let index = 0; index < quantity; index += 1) {
    const name = holderNames[index]?.trim().slice(0, 120)
    if (name) entries[`ticket_name_${index + 1}`] = name
  }

  return entries
}
