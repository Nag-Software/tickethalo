import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'
import { osloDate, ticketSalesState } from '@/lib/ticket-sales'
import {
  deletionOutcome,
  normalizeShowSalesSummary,
  type ShowSalesOverview,
  type ShowSalesSummary,
} from '@/lib/show-sales-shared'

/**
 * Billettsalget på ett show, slik bookeren styrer det: stenge salget, åpne
 * det igjen, og se hva som står i veien for å slette showet.
 *
 * Reglene for *når* et show kan selge ligger i `lib/ticket-sales.ts`, og
 * reglene for *om* et show kan slettes ligger i `delete_show()` i databasen.
 * Denne modulen leser begge og oversetter dem til noe admin kan vise — den
 * bestemmer ingenting selv som databasen ikke også håndhever.
 *
 * Bare for serveren. De rene reglene og ordene ligger i
 * `lib/show-sales-shared.ts`, som klientkomponentene importerer direkte, og
 * eksporteres videre herfra.
 */

export * from '@/lib/show-sales-shared'

/**
 * Stengingen av salget gikk gjennom i databasen, men checkout-sesjonene som
 * allerede var åpne hos Stripe kunne ikke listes. Salget *er* stengt, og
 * databasen avviser billetter etter stengingen — en kjøper som likevel
 * fullfører betalingen, får pengene refundert automatisk.
 */
export class CheckoutSessionExpiryError extends Error {
  readonly expiredCheckoutSessions: number

  constructor(message: string, expiredCheckoutSessions: number) {
    super(message)
    this.name = 'CheckoutSessionExpiryError'
    this.expiredCheckoutSessions = expiredCheckoutSessions
  }
}

export async function getShowSalesOverview(showId: string): Promise<ShowSalesOverview> {
  if (!showId) throw new Error('The show id is missing.')

  const db = createAdminClient()
  const [showResult, summary] = await Promise.all([
    db
      .from('shows')
      .select('id, title, status, date, currency, ticket_sales_closed_at, deleted_at, club_id')
      .eq('id', showId)
      .maybeSingle(),
    getShowSalesSummary(showId),
  ])

  if (showResult.error) throw new Error(`Could not load the show: ${showResult.error.message}`)
  if (!showResult.data) throw new Error('This show no longer exists.')

  const show = showResult.data

  return {
    showId: show.id,
    title: show.title,
    status: show.status,
    date: show.date,
    currency: show.currency,
    sales: ticketSalesState(show),
    summary,
    deletion: deletionOutcome(summary),
  }
}

export async function getShowSalesSummary(showId: string): Promise<ShowSalesSummary> {
  const { data, error } = await createAdminClient().rpc('show_sales_summary', { p_show_id: showId }).single()

  if (error || !data) {
    throw new Error(`Could not load ticket sales for the show: ${error?.message ?? 'no summary was returned'}`)
  }

  return normalizeShowSalesSummary(data)
}

/**
 * Når den eldste betalingen som fortsatt ligger på klubbens saldo ble gjort:
 * en betalt ordre, eller en betaling uten billett som ikke er refundert ennå.
 * Det er den Stripe betaler ut først, og den som bestemmer hvor langt fram
 * showet kan flyttes. `null` når showet ikke har noen.
 */
export async function earliestOutstandingSaleAt(showId: string): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from('orders')
    .select('created_at')
    .eq('show_id', showId)
    .not('stripe_payment_intent_id', 'is', null)
    .or('status.eq.paid,and(status.eq.cancelled,refunded_at.is.null)')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Could not load the orders for the show: ${error.message}`)
  return data?.created_at ?? null
}

/**
 * Stenger billettsalget.
 *
 * Idempotent: filteret på `ticket_sales_closed_at is null` gjør at et andre
 * klikk ikke flytter tidspunktet eller hvem som stengte. Utløpet av åpne
 * checkout-sesjoner kjøres likevel hver gang, så et nytt forsøk rydder opp
 * det forrige ikke rakk.
 *
 * Kaster `CheckoutSessionExpiryError` når salget er stengt, men Stripe ikke
 * kunne svare på hvilke kjøp som var i gang. `failedCheckoutSessions` er kjøp
 * Stripe listet, men ikke lot oss avbryte.
 */
export async function stopTicketSales(
  showId: string,
  actorId: string | null,
): Promise<{ expiredCheckoutSessions: number; failedCheckoutSessions: number }> {
  if (!showId) throw new Error('The show id is missing.')

  await closeTicketSales(showId, actorId)
  const { expired, failed } = await expireOpenCheckoutSessions(showId)
  return { expiredCheckoutSessions: expired, failedCheckoutSessions: failed }
}

/** Setter `ticket_sales_closed_at`. `true` når det var dette kallet som stengte salget. */
async function closeTicketSales(showId: string, actorId: string | null): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('shows')
    .update({ ticket_sales_closed_at: new Date().toISOString(), ticket_sales_closed_by: actorId })
    .eq('id', showId)
    .is('ticket_sales_closed_at', null)
    .is('deleted_at', null)
    .select('id')

  if (error) throw new Error(`Could not stop ticket sales: ${error.message}`)
  return (data?.length ?? 0) > 0
}

/**
 * Før et show slettes eller arkiveres: stenger salget og avbryter kjøp som er
 * i gang.
 *
 * `delete_show()` ser bare ordrer, ikke checkout-sesjoner. Uten dette kunne en
 * kjøper som sto på betalingssiden betalt for et show som var borte, og fått
 * pengene tilbake etter en stund — mens Tickethalo betaler Stripe-gebyret.
 *
 * Rekkefølgen er valgt. Stengingen kommer først, fordi databasen da avviser
 * hver betaling som fullføres etter den (`sales_closed`) og refunderer den
 * automatisk — også sesjoner utløpet ikke rekker. Utløpet kommer før selve
 * slettingen, fordi klubbens Stripe-konto slås opp via showraden, som er borte
 * etter en ekte sletting.
 *
 * Et show som aldri har vært publisert har aldri kunnet åpne en sesjon, og
 * slipper kallet til Stripe. Feil i utløpet logges og stopper ikke
 * slettingen: stengingen i databasen er det som faktisk hindrer salg.
 *
 * Returnerer om salget ble stengt av dette kallet, så en sletting som likevel
 * stopper kan si det til bookeren.
 */
export async function stopSalesBeforeDeletion(showId: string, actorId: string | null): Promise<{ salesStopped: boolean }> {
  const { data: show, error } = await createAdminClient()
    .from('shows')
    .select('status, published_at')
    .eq('id', showId)
    .maybeSingle()

  if (error) throw new Error(`Could not load the show: ${error.message}`)
  if (!show || (show.status !== 'published' && !show.published_at)) return { salesStopped: false }

  const salesStopped = await closeTicketSales(showId, actorId)

  try {
    const { failed } = await expireOpenCheckoutSessions(showId)
    if (failed > 0) {
      console.error(
        `[ShowSales] Deleting show ${showId}: ${failed} open checkout sessions could not be expired. ` +
          'Payments on them are refunded as sales_closed/invalid_show.',
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[ShowSales] Deleting show ${showId}: could not expire open checkout sessions: ${message}`)
  }

  return { salesStopped }
}

/**
 * Avbryter checkout-sesjonene som er åpne hos Stripe for showet.
 *
 * Databasen avviser en betaling som fullføres etter at salget er stengt
 * (`sales_closed`), og pengene refunderes automatisk. Men kjøperen er da
 * belastet og får pengene tilbake først etter noen dager, og Tickethalo
 * betaler Stripe-gebyret. Det er bedre at betalingssiden lukker seg.
 *
 * Sesjonene ligger på klubbens Connect-konto (direct charge), ikke på
 * plattformen, og Stripe kan ikke filtrere på metadata — så klubbens åpne
 * sesjoner listes og showets plukkes ut.
 *
 * Kaster `CheckoutSessionExpiryError` når listen ikke kan hentes. `failed` er
 * sesjoner som fortsatt var åpne da Stripe avviste utløpet.
 */
export async function expireOpenCheckoutSessions(showId: string): Promise<{ expired: number; failed: number }> {
  const stripeAccount = await stripeAccountForShow(showId)
  // Uten Connect-konto har klubben aldri kunnet åpne en sesjon.
  if (!stripeAccount) return { expired: 0, failed: 0 }

  // Listen samles først og sesjonene utløper etterpå. Å utløpe underveis
  // ville endret settet `status: 'open'` som pagineringen går gjennom.
  const sessionIds: string[] = []
  try {
    for await (const session of stripe.checkout.sessions.list({ status: 'open', limit: 100 }, { stripeAccount })) {
      if (session.metadata?.show_id === showId) sessionIds.push(session.id)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[ShowSales] Could not list open checkout sessions for show ${showId} on ${stripeAccount}: ${message}`)
    throw new CheckoutSessionExpiryError(
      "Ticket sales are stopped, but Stripe couldn't tell us which purchases were in progress, so they weren't " +
        'cancelled. A buyer who still completes a payment is refunded automatically and gets no ticket.',
      0,
    )
  }

  let expired = 0
  let failed = 0
  for (const sessionId of sessionIds) {
    try {
      await stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount })
      expired += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Sesjonen kan ha blitt fullført eller utløpt av seg selv i mellomtiden.
      // Det er ikke en feil ved stengingen. Alt annet (nettverk, 429, 5xx
      // etter SDK-ets egne forsøk) betyr at kjøpet fortsatt kan fullføres, og
      // det skal telles — ikke bare logges.
      if (await isNoLongerOpen(sessionId, stripeAccount)) {
        console.warn(`[ShowSales] Checkout session ${sessionId} for show ${showId} was no longer open: ${message}`)
      } else {
        failed += 1
        console.error(`[ShowSales] Could not expire checkout session ${sessionId} for show ${showId}: ${message}`)
      }
    }
  }

  if (sessionIds.length > 0) {
    console.log(
      `[ShowSales] Show ${showId}: expired ${expired}/${sessionIds.length} open checkout sessions, ${failed} failed`,
    )
  }

  return { expired, failed }
}

/** `true` bare når Stripe bekrefter at sesjonen ikke lenger kan betales. */
async function isNoLongerOpen(sessionId: string, stripeAccount: string): Promise<boolean> {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount })
    return session.status !== 'open'
  } catch {
    return false
  }
}

/**
 * Klubbens Connect-konto for showet.
 *
 * Slås opp direkte framfor via `getClubForShow`, som gjør en databasefeil om
 * til `null`. Her ville det betydd at påbegynte kjøp stille ble stående —
 * feilen skal fram.
 */
async function stripeAccountForShow(showId: string): Promise<string | null> {
  const db = createAdminClient()

  const { data: show, error: showError } = await db.from('shows').select('club_id').eq('id', showId).maybeSingle()
  if (showError) throw new Error(`Could not load the show: ${showError.message}`)
  if (!show?.club_id) return null

  const { data: club, error: clubError } = await db
    .from('clubs')
    .select('stripe_account_id')
    .eq('id', show.club_id)
    .maybeSingle()
  if (clubError) throw new Error(`Could not load the club: ${clubError.message}`)

  return club?.stripe_account_id ?? null
}

/**
 * Åpner salget igjen etter at bookeren har stengt det.
 *
 * Tar bare bort stengingen. Salgsvinduet på 90 dager gjelder fortsatt — et
 * show langt fram i tid går tilbake til «opens on …», ikke til åpent salg.
 */
export async function resumeTicketSales(showId: string): Promise<void> {
  if (!showId) throw new Error('The show id is missing.')

  const db = createAdminClient()
  const { data: show, error } = await db
    .from('shows')
    .select('id, status, date, deleted_at, ticket_sales_closed_at')
    .eq('id', showId)
    .maybeSingle()

  if (error) throw new Error(`Could not load the show: ${error.message}`)
  if (!show) throw new Error('This show no longer exists.')
  if (show.deleted_at) throw new Error('This show has been deleted, so ticket sales cannot be resumed.')
  if (show.status === 'cancelled') throw new Error('This show is cancelled, so ticket sales cannot be resumed.')
  if (show.status === 'completed') throw new Error('This show is completed, so ticket sales cannot be resumed.')
  if (show.date.slice(0, 10) < osloDate()) {
    throw new Error('This show has already taken place, so ticket sales cannot be resumed.')
  }

  // Allerede åpent: ingenting å gjøre, og ingen grunn til å si fra.
  if (!show.ticket_sales_closed_at) return

  const { error: updateError } = await db
    .from('shows')
    .update({ ticket_sales_closed_at: null, ticket_sales_closed_by: null })
    .eq('id', showId)
    .is('deleted_at', null)

  if (updateError) throw new Error(`Could not resume ticket sales: ${updateError.message}`)
}
