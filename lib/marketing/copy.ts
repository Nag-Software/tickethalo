/**
 * Teksten som følger med eksportfilene.
 *
 * Et Facebook-event er ikke bare et coverbilde — noen må skrive tittelen,
 * tidspunktet, stedet og lineupen inn i skjemaet. Den teksten kan vi lage
 * ferdig, slik at klubben limer inn i stedet for å skrive. Samme innhold i
 * kortere form er bildeteksten til SoMe-posten.
 *
 * Ingen Node-avhengigheter: både server og klient bruker den.
 */

const MONTHS_NB = [
  'januar', 'februar', 'mars', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'desember',
]

const WEEKDAYS_NB = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag']

export type MarketingCopyInput = {
  title: string
  date: string
  startTime: string | null
  doorsTime?: string | null
  venue: string | null
  city?: string | null
  description: string | null
  ticketUrl: string | null
  priceLabel: string | null
  lineup: Array<{ name: string; roleLabel: string | null }>
}

export function formatNorwegianDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return `${WEEKDAYS_NB[parsed.getDay()]} ${parsed.getDate()}. ${MONTHS_NB[parsed.getMonth()]} ${parsed.getFullYear()}`
}

function timeLabel(startTime: string | null) {
  return startTime ? `kl. ${startTime.slice(0, 5)}` : null
}

/** Lang tekst — beskrivelsesfeltet på Facebook-eventet. */
export function facebookEventDescription(input: MarketingCopyInput): string {
  const headliners = input.lineup.filter((entry) => entry.roleLabel?.toLowerCase().includes('headliner'))
  const rest = input.lineup.filter((entry) => !headliners.includes(entry))

  return [
    input.description?.trim() || `${input.title} — en kveld med stand-up.`,
    '',
    'LINEUP',
    ...[...headliners, ...rest].map((entry) => (
      entry.roleLabel ? `• ${entry.name} (${entry.roleLabel})` : `• ${entry.name}`
    )),
    input.lineup.length === 0 ? '• Lineup annonseres snart' : null,
    '',
    'PRAKTISK',
    `• ${formatNorwegianDate(input.date)}${timeLabel(input.startTime) ? `, ${timeLabel(input.startTime)}` : ''}`,
    input.venue ? `• ${input.venue}${input.city ? `, ${input.city}` : ''}` : null,
    input.priceLabel ? `• Billetter fra ${input.priceLabel}` : null,
    '',
    input.ticketUrl ? `Billetter: ${input.ticketUrl}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Kort tekst — bildeteksten under SoMe-posten. */
export function socialCaption(input: MarketingCopyInput): string {
  const names = input.lineup.map((entry) => entry.name)
  const nameLine = names.length > 0
    ? names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`
    : null

  return [
    `${input.title.toUpperCase()} 🎤`,
    nameLine,
    `${formatNorwegianDate(input.date)}${timeLabel(input.startTime) ? ` ${timeLabel(input.startTime)}` : ''}${input.venue ? ` · ${input.venue}` : ''}`,
    input.ticketUrl ? `Billetter i bio / ${input.ticketUrl}` : 'Billetter i bio',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Tittelfeltet på Facebook-eventet. */
export function facebookEventTitle(input: MarketingCopyInput): string {
  const headliner = input.lineup.find((entry) => entry.roleLabel?.toLowerCase().includes('headliner'))
  return headliner ? `${input.title} — ${headliner.name}` : input.title
}
