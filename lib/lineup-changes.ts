import type { LineupChangeField, LineupChangeNotice } from '@/types/database'
import { showVenue } from '@/lib/show-venue'

/**
 * Endringsdyttet på Communication-fanen.
 *
 * Flytter klubben et show etter at noen har sagt ja, er det lineupen som
 * står igjen med feil tid i kalenderen. Vi sender ikke noe selv — klubben
 * vet best om endringen trenger en forklaring — men fanen får et tall, og
 * en ferdig skrevet melding venter.
 *
 * `shows.lineup_change_notice` husker hva som er endret siden lineupen sist
 * fikk beskjed: { felt: { from, to } }. Skjemaet lagrer for hvert felt, så
 * én endring kan komme i flere lagringer. Derfor beholdes den første
 * «from», bare «to» følger med, og et felt som er tilbake der det startet
 * faller bort — 19:00 → 19:30 → 19:00 er ingen endring.
 *
 * Ingen Node-avhengigheter: både server og klient bruker den.
 */

export const LINEUP_CHANGE_FIELDS: LineupChangeField[] = ['date', 'start_time', 'venue']

export type ChangeWatchedShow = {
  date: string
  start_time: string | null
  venue_name: string | null
  venue_address: string | null
}

/** Verdien slik den sammenlignes og vises: dato, `HH:MM` og stedet på én linje. */
export function watchedValue(show: ChangeWatchedShow, field: LineupChangeField): string | null {
  if (field === 'date') return show.date?.slice(0, 10) || null
  if (field === 'start_time') return show.start_time?.slice(0, 5) || null
  return showVenue(show).line
}

export function mergeChangeNotice(
  existing: LineupChangeNotice | null | undefined,
  before: ChangeWatchedShow,
  after: ChangeWatchedShow,
): LineupChangeNotice | null {
  const next: LineupChangeNotice = { ...(existing ?? {}) }

  for (const field of LINEUP_CHANGE_FIELDS) {
    const was = watchedValue(before, field)
    const now = watchedValue(after, field)
    if (was === now) continue

    const from = existing && field in existing ? existing[field]!.from : was
    if (from === now) delete next[field]
    else next[field] = { from, to: now }
  }

  return Object.keys(next).length > 0 ? next : null
}

/** Antall felt — tallet på fanen. */
export function changeCount(notice: LineupChangeNotice | null | undefined) {
  return notice ? LINEUP_CHANGE_FIELDS.filter((field) => notice[field]).length : 0
}

const FIELD_NOUN: Record<LineupChangeField, string> = { date: 'date', start_time: 'time', venue: 'venue' }
const FIELD_LABEL: Record<LineupChangeField, string> = { date: 'Date', start_time: 'Start time', venue: 'Venue' }

function listJoin(words: string[]) {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** «The time of the show was changed, remember to notify your line-up.» */
export function changeHeadline(notice: LineupChangeNotice) {
  const fields = LINEUP_CHANGE_FIELDS.filter((field) => notice[field])
  const nouns = listJoin(fields.map((field) => FIELD_NOUN[field]))
  return `The ${nouns} of the show ${fields.length > 1 ? 'were' : 'was'} changed, remember to notify your line-up.`
}

function displayValue(field: LineupChangeField, value: string | null) {
  if (!value) return 'not set'
  if (field !== 'date') return value
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)))
}

/** Radene «Start time: 19:00 → 20:00», til fanen og meldingen. */
export function changeLines(notice: LineupChangeNotice) {
  return LINEUP_CHANGE_FIELDS.flatMap((field) => {
    const change = notice[field]
    if (!change) return []
    return [{
      field,
      label: FIELD_LABEL[field],
      from: displayValue(field, change.from),
      to: displayValue(field, change.to),
    }]
  })
}

/** Meldingen klubben kan sende som den er, eller skrive om. */
export function suggestedChangeMessage(notice: LineupChangeNotice, showTitle: string) {
  const fields = LINEUP_CHANGE_FIELDS.filter((field) => notice[field])
  const nouns = listJoin(fields.map((field) => FIELD_NOUN[field]))
  const lines = changeLines(notice).map((line) => `${line.label}: ${line.from} → ${line.to}`)
  return [
    `Heads up: the ${nouns} for ${showTitle} ${fields.length > 1 ? 'have' : 'has'} changed.`,
    '',
    ...lines,
    '',
    'Everything else stays the same. If this does not work for you, reply to this email.',
  ].join('\n')
}
