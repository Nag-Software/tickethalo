import type { BookingSettings } from '@/lib/booking-settings'

/**
 * Tiden i bookingen: bølgene, lineup-fristen og svarfristene.
 *
 * Alt her er rene funksjoner på datoer og innstillinger, uten databasen, så
 * reglene kan prøves ut i tester i stedet for ved å vente et døgn.
 *
 * Dagene regnes i norsk tid. En kjøring 06:00 UTC i januar er 07:00 i Oslo,
 * men om sommeren 08:00 — og en bølge som teller dager i UTC ville hoppet
 * over en dag hver gang klokken stilles.
 */

const OSLO_TIME_ZONE = 'Europe/Oslo'
const DAY_MS = 24 * 60 * 60 * 1000

const osloDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: OSLO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Datoen i Oslo, som `YYYY-MM-DD`. */
export function osloDateString(at: Date = new Date()): string {
  return osloDateFormatter.format(at)
}

/** Hele dager fra én `YYYY-MM-DD` til en annen. Negativt når `to` er før `from`. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.round((end - start) / DAY_MS)
}

const osloOffsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: OSLO_TIME_ZONE,
  timeZoneName: 'longOffset',
})

/** Oslos avstand fra UTC på et gitt tidspunkt, i millisekunder. +1 eller +2 timer. */
function osloOffsetMs(at: Date): number {
  const name = osloOffsetFormatter.formatToParts(at).find((part) => part.type === 'timeZoneName')?.value
  const match = name?.match(/GMT([+-])(\d{2}):(\d{2})/)
  if (!match) return 60 * 60 * 1000

  const sign = match[1] === '-' ? -1 : 1
  return sign * ((Number(match[2]) * 60 + Number(match[3])) * 60 * 1000)
}

/**
 * Slutten av dagen — i norsk tid.
 *
 * Sto det `T23:59:59Z`, var «slutten av 27. februar» i virkeligheten 00:59
 * den 28. i Oslo. Det flyttet lineup-fristen en dag ut, lot hastemodus
 * starte et døgn for sent, og gjorde at et tilbud som aldri skulle leve inn
 * i showdagen kunne besvares på morgenen samme dag.
 */
export function osloEndOfDay(date: string): number {
  const naive = Date.parse(`${date}T23:59:59Z`)
  if (Number.isNaN(naive)) return naive
  return naive - osloOffsetMs(new Date(naive))
}

/** `YYYY-MM-DD`, n dager før den gitte datoen. */
export function dateMinusDays(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(base)) return date
  return new Date(base - days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Når lineupen skal være klar.
 *
 * Plakat, Facebook-event og kalenderpartnere trenger tid, så fristen ligger
 * et stykke foran showet. Klubben setter sin egen på Min klubb; ellers
 * gjelder plattformens standard.
 */
export function lineupDeadlineAt(showDate: string, deadlineDays: number): Date {
  return new Date(osloEndOfDay(dateMinusDays(showDate, deadlineDays)))
}

/**
 * Hastemodus: fra `rush_days` før lineup-fristen, og alltid etter den.
 *
 * Da slutter motoren å trappe opp. Nå er det viktigere at plassen blir
 * fylt enn at den beste får den først.
 *
 * Regnes på datoer, ikke på tidspunkt. Trakk vi fem døgn fra selve fristen
 * — som er ved midnatt — begynte hastemodus først i den siste timen av dag
 * fem, og morgenkjøringen den dagen gikk fortsatt i normal takt. «Fra fem
 * dager før» mistet dermed den første av de fem dagene, akkurat når det
 * hastet mest.
 */
export function isRushMode({
  now,
  showDate,
  deadlineDays,
  settings,
}: {
  now: Date
  showDate: string
  deadlineDays: number
  settings: BookingSettings
}): boolean {
  return osloDateString(now) >= dateMinusDays(showDate, deadlineDays + settings.rush_days)
}

/**
 * Hvor mange tilbud fra motoren som skal stå ute på ett ledig sete nå.
 *
 * Dag 1 er dagen automatikken begynte på plassen. Målet er `2 × dag`, med
 * taket på 10 — og hele taket med en gang i hastemodus.
 *
 * At det er et *mål* og ikke «send så mange nå», er poenget: kjøringen kan
 * skje så ofte den vil, etter hvert nei og hver morgen, uten at noen får
 * flere tilbud enn bølgen tilsier.
 */
export function offerTarget({
  autoStartedAt,
  now,
  settings,
  rush,
}: {
  autoStartedAt: string | null
  now: Date
  settings: BookingSettings
  rush: boolean
}): number {
  // Motoren jobber bare på plasser den har fått beskjed om å jobbe på.
  if (!autoStartedAt) return 0
  if (rush) return settings.offers_per_slot

  const started = Date.parse(autoStartedAt)
  if (Number.isNaN(started)) return settings.offers_per_day

  const day = Math.max(1, daysBetween(osloDateString(new Date(started)), osloDateString(now)) + 1)
  return Math.min(settings.offers_per_slot, settings.offers_per_day * day)
}

/**
 * Når et tilbud som sendes nå, går ut. Null betyr at det ikke skal sendes.
 *
 * Sju dager er utgangspunktet, men fristen er alltid underlagt kvelden den
 * gjelder: den går aldri forbi lineup-fristen, og aldri forbi showet. Er
 * lineup-fristen passert, kortes svartiden til 48 timer, og siste frist er
 * dagen før showet.
 *
 * På selve showdagen sender motoren ingenting. Da er det bookeren som må
 * ringe, og en e-post med et døgns frist hjelper ingen.
 */
export function offerExpiresAt({
  now,
  showDate,
  lineupDeadline,
  settings,
}: {
  now: Date
  showDate: string
  lineupDeadline: Date
  settings: BookingSettings
}): string | null {
  if (!showDate) return null
  if (osloDateString(now) >= showDate) return null

  const nowMs = now.getTime()
  const showEnd = osloEndOfDay(showDate)
  const dayBeforeShowEnd = osloEndOfDay(dateMinusDays(showDate, 1))

  // Den korte fristen, som også er gulvet: er lineup-fristen så nær at sju
  // dager ville blitt til to timer, er det denne som gjelder.
  const late = Math.min(nowMs + settings.late_offer_response_hours * 60 * 60 * 1000, dayBeforeShowEnd)

  if (nowMs > lineupDeadline.getTime()) {
    return late > nowMs ? new Date(late).toISOString() : null
  }

  const normal = Math.min(
    nowMs + settings.offer_response_days * DAY_MS,
    lineupDeadline.getTime(),
    showEnd,
  )

  const chosen = Math.max(normal, late)
  return chosen > nowMs ? new Date(chosen).toISOString() : null
}

/** Korteste tilbud som er verdt en påminnelse. Under dette er e-posten støy. */
const REMINDER_MIN_WINDOW_MS = 3 * DAY_MS

/**
 * Om komikeren skal minnes på fristen nå.
 *
 * Bare én gang per tilbud (`reminded_at`), og bare på tilbud som hadde mer
 * enn tre døgns frist da de gikk ut. Et tilbud på 48 timer er allerede en
 * påminnelse i seg selv.
 */
export function shouldRemind({
  offer,
  now,
  settings,
}: {
  offer: { sent_at: string | null; expires_at: string | null; reminded_at: string | null; status: string }
  now: Date
  settings: BookingSettings
}): boolean {
  if (offer.status !== 'sent') return false
  if (offer.reminded_at) return false
  if (settings.reminder_hours <= 0) return false
  if (!offer.expires_at || !offer.sent_at) return false

  const expires = Date.parse(offer.expires_at)
  const sent = Date.parse(offer.sent_at)
  if (Number.isNaN(expires) || Number.isNaN(sent)) return false
  if (expires - sent <= REMINDER_MIN_WINDOW_MS) return false

  const msLeft = expires - now.getTime()
  return msLeft > 0 && msLeft <= settings.reminder_hours * 60 * 60 * 1000
}
