import { dateMinusDays, daysBetween, osloDateString } from '@/lib/booking-schedule'
import type { ShowStatus } from '@/types/database'

/**
 * Påminnelsen til lineupen, 5 dager før showet — reglene.
 *
 * Sendes av den daglige jobben (`/api/cron/lineup-reminders`, 06:00 UTC).
 * Selve utsendingen står i lib/lineup-messages.ts; her er bare hvem og når,
 * som rene funksjoner, så sommertid og «bare én gang» kan prøves i tester.
 *
 *  - Dagene telles i Oslo. 06:00 UTC er 07:00 om vinteren og 08:00 om
 *    sommeren, og datoen er den samme i begge.
 *  - Et vindu, ikke én dag: fra 5 dager før til dagen før. Feiler en
 *    kjøring, går påminnelsen neste morgen. Blir noen booket 3 dager før,
 *    får hen sin neste morgen. Showdagen selv sender ingenting.
 *  - Én gang per plass (`confirmed_spots.lineup_reminder_sent_at`), ikke per
 *    show — de som alt har fått den, får den ikke igjen.
 */

export const REMINDER_DAYS_BEFORE = 5

/** Klokken jobben går, i UTC. Se .github/workflows/run-automation.yml. */
const CRON_HOUR_UTC = 6

export type ReminderShow = {
  date: string
  status: ShowStatus
  deleted_at: string | null
  is_template: boolean
  lineup_reminder_enabled: boolean | null
}

/** Showets eget valg, ellers klubbens standard. */
export function reminderEnabled(show: Pick<ReminderShow, 'lineup_reminder_enabled'>, clubDefault: boolean | null | undefined) {
  return show.lineup_reminder_enabled ?? clubDefault ?? true
}

/** Et show som er avlyst, spilt, slettet eller bare en mal, minnes det ikke om. */
function remindable(show: ReminderShow) {
  return !show.deleted_at && !show.is_template && show.status !== 'cancelled' && show.status !== 'completed'
}

/** Første dag påminnelsen kan gå: 5 dager før. */
export function reminderSendDate(showDate: string) {
  return dateMinusDays(showDate.slice(0, 10), REMINDER_DAYS_BEFORE)
}

/** Om dagens kjøring skal sende påminnelsen for showet. */
export function reminderDueToday(show: ReminderShow, clubDefault: boolean | null | undefined, now: Date = new Date()) {
  if (!remindable(show) || !reminderEnabled(show, clubDefault)) return false
  const daysLeft = daysBetween(osloDateString(now), show.date.slice(0, 10))
  return daysLeft >= 1 && daysLeft <= REMINDER_DAYS_BEFORE
}

/** Datoen (Oslo) jobben neste gang går. */
export function nextReminderRunDate(now: Date = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), CRON_HOUR_UTC))
  const next = now.getTime() < today.getTime() ? today : new Date(today.getTime() + 24 * 60 * 60 * 1000)
  return osloDateString(next)
}

export type ReminderPlan =
  | { kind: 'off' }
  /** Showet er avlyst, spilt eller i dag — det er for sent. */
  | { kind: 'closed' }
  | { kind: 'scheduled'; on: string }

/** Hva fanen sier om påminnelsen: av, for sent, eller dagen den går. */
export function reminderPlan(show: ReminderShow, clubDefault: boolean | null | undefined, now: Date = new Date()): ReminderPlan {
  if (!reminderEnabled(show, clubDefault)) return { kind: 'off' }
  if (!remindable(show)) return { kind: 'closed' }

  const sendDate = reminderSendDate(show.date)
  const nextRun = nextReminderRunDate(now)
  const on = sendDate > nextRun ? sendDate : nextRun
  return on >= show.date.slice(0, 10) ? { kind: 'closed' } : { kind: 'scheduled', on }
}
