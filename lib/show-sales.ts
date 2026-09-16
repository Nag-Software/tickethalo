import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'
import { osloDate, ticketSalesState } from '@/lib/ticket-sales'
import { deletionOutcome, normalizeShowSalesSummary, type ShowSalesOverview } from '@/lib/show-sales-shared'

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
 * allerede var åpne hos Stripe kunne ikke listes. Salget *er* stengt — det er
 * bare kjøp som var påbegynt før stengingen som fortsatt kan fullføres.
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
  const [showResult, summaryResult] = await Promise.all([
    db
      .from('shows')
      .select('id, title, status, date, currency, ticket_sales_closed_at, deleted_at, club_id')
      .eq('id', showId)
      .maybeSingle(),
    db.rpc('show_sales_summary', { p_show_id: showId }).single(),
  ])

  if (showResult.error) throw new Error(`Could not load the show: ${showResult.error.message}`)
  if (!showResult.data) throw new Error('This show no longer exists.')
  if (summaryResult.error || !summaryResult.data) {
    throw new Error(
      `Could not load ticket sales for the show: ${summaryResult.error?.message ?? 'no summary was returned'}`,
    )
  }

  const show = showResult.data
  const summary = normalizeShowSalesSummary(summaryResult.data)

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

/**
 * Stenger billettsalget.
 *
 * Idempotent: filteret på `ticket_sales_closed_at is null` gjør at et andre
 * klikk ikke flytter tidspunktet eller hvem som stengte. Utløpet av åpne
 * checkout-sesjoner kjøres likevel hver gang, så et nytt forsøk rydder opp
 * det forrige ikke rakk.
 *
 * Kaster `CheckoutSessionExpiryError` når salget er stengt, men Stripe ikke
 * kunne svare på hvilke kjøp som var i gang.
 */
export async function stopTicketSales(
  showId: string,
  actorId: string | null,
): Promise<{ expiredCheckoutSessions: number }> {
  if (!showId) throw new Error('The show id is missing.')

  const db = createAdminClient()
  const { error } = await db
    .from('shows')
    .update({ ticket_sales_closed_at: new Date().toISOString(), ticket_sales_closed_by: actorId })
    .eq('id', showId)
    .is('ticket_sales_closed_at', null)
    .is('deleted_at', null)

  if (error) throw new Error(`Could not stop ticket sales: ${error.message}`)

  const expiredCheckoutSessions = await expireOpenCheckoutSessions(showId)
  return { expiredCheckoutSessions }
}

/**
 * Checkout-sesjoner som er åpne hos Stripe kan fullføres selv etter at salget
 * er stengt: checkout sjekker salgsstatus når sesjonen *opprettes*, og
 * `complete_checkout_order` utsteder billetter for et publisert show uansett.
 * En kjøper som sto på betalingssiden da salget ble stengt, ville ellers fått
 * billett. Derfor utløper vi dem.
 *
 * Sesjonene ligger på klubbens Connect-konto (direct charge), ikke på
 * plattformen, og Stripe kan ikke filtrere på metadata — så klubbens åpne
 * sesjoner listes og showets plukkes ut.
 */
async function expireOpenCheckoutSessions(showId: string): Promise<number> {
  const stripeAccount = await stripeAccountForShow(showId)
  // Uten Connect-konto har klubben aldri kunnet åpne en sesjon.
  if (!stripeAccount) return 0

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
      'Ticket sales are stopped, but checkouts already in progress could not be cancelled. ' +
        'Buyers who were already on the payment page may still complete their purchase.',
      0,
    )
  }

  let expired = 0
  for (const sessionId of sessionIds) {
    try {
      await stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount })
      expired += 1
    } catch (error) {
      // Sesjonen kan ha blitt fullført eller utløpt av seg selv i mellomtiden.
      // Det er ikke en feil ved stengingen — de neste sesjonene skal fortsatt tas.
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[ShowSales] Could not expire checkout session ${sessionId} for show ${showId}: ${message}`)
    }
  }

  if (sessionIds.length > 0) {
    console.log(`[ShowSales] Show ${showId}: expired ${expired}/${sessionIds.length} open checkout sessions`)
  }

  return expired
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
