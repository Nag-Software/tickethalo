import { createAdminClient } from '@/lib/supabase/admin'

type Db = ReturnType<typeof createAdminClient>

/**
 * Vakt mot at to samtidige klikk fyller den samme plassen to ganger.
 *
 * Databasen har ingen grense på antall bekreftede plasser per krav — den kan
 * ikke ha det, siden `quantity` varierer. Den unike indeksen på
 * `(show_id, artist_id)` hindrer bare at *den samme* komikeren står to
 * ganger.
 *
 * Komikerens egen vei går gjennom `accept_booking_offer`, som låser kravet
 * (`select … for update`) før den teller. Bookerens veier i admin gjør ikke
 * det: de teller, og setter så inn, i to omganger. To bookere som godtar
 * hver sin komiker på den samme Headliner-plassen i det samme sekundet, leser
 * begge «null fylt» og setter begge inn. Da står showet med to headlinere,
 * klubben skylder to honorarer, og publiseringen synes lineupen er komplett.
 *
 * Dette lukker ikke vinduet — det gjør bare en lås i databasen — men det
 * fanger opp resultatet: setter vi inn en plass for mye, angrer vi vår egen
 * og sier fra, i stedet for å la overfyllingen bli stående.
 */
export async function rollBackIfSeatWasTaken(
  db: Db,
  { requirementId, spotId }: { requirementId: string; spotId: string },
): Promise<void> {
  const [{ data: requirement }, { data: spots }] = await Promise.all([
    db.from('show_requirements').select('quantity, role_name').eq('id', requirementId).maybeSingle(),
    db.from('confirmed_spots')
      .select('id, confirmed_at')
      .eq('show_requirement_id', requirementId)
      .in('status', ['confirmed', 'completed', 'paid'])
      .order('confirmed_at', { ascending: true }),
  ])

  if (!requirement) return
  const seats = spots ?? []
  if (seats.length <= requirement.quantity) return

  // Den som kom sist, taper. Vår egen rad er den eneste vi har lov til å
  // angre — kom vi først, er det den andre kjøringen som må rydde opp.
  const losers = seats.slice(requirement.quantity).map((seat) => seat.id)
  if (!losers.includes(spotId)) return

  await db
    .from('confirmed_spots')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', spotId)

  throw new Error(`Rollen "${requirement.role_name}" ble fylt av en annen akkurat nå. Prøv igjen.`)
}
