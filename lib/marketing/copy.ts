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

// ─────────────────────────────────────────────────────────────
// Engelsk: e-posten om showet og tekstfila i showmateriellet
//
// Portalen og e-postene til publikum er på engelsk. Klubben redigerer teksten
// før den sendes, så dette er et utkast, ikke et ferdig produkt.
// ─────────────────────────────────────────────────────────────

const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Datoen som kalenderdag. En showdato har ingen tidssone — den bygges midt på
 * dagen i UTC, så den ikke kan tippe over til dagen før.
 */
function parseShowDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!match) return null
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * «Sat 9 Oct». Skrevet ut for hånd, ikke med `Intl`: `en-GB` gir «Sept» for
 * september i nyere ICU, og emnet skal se likt ut på server og i nettleser.
 */
export function formatShortEnglishDate(date: string): string {
  const parsed = parseShowDate(date)
  if (!parsed) return date
  return `${WEEKDAYS_EN[parsed.getUTCDay()].slice(0, 3)} ${parsed.getUTCDate()} ${MONTHS_EN[parsed.getUTCMonth()].slice(0, 3)}`
}

/** «Saturday 9 October 2026». */
export function formatLongEnglishDate(date: string): string {
  const parsed = parseShowDate(date)
  if (!parsed) return date
  return `${WEEKDAYS_EN[parsed.getUTCDay()]} ${parsed.getUTCDate()} ${MONTHS_EN[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`
}

/** «New show from Crønch Comedy - Sat 9 Oct - Friday Night Live». Formen er bestemt i ClickUp 869fgj7fu. */
export function showEmailSubject(input: { clubName: string; date: string; title: string }): string {
  return `New show from ${input.clubName.trim()} - ${formatShortEnglishDate(input.date)} - ${input.title.trim()}`
}

function englishLineupLines(lineup: MarketingCopyInput['lineup']) {
  const headliners = lineup.filter((entry) => entry.roleLabel?.toLowerCase().includes('headliner'))
  const rest = lineup.filter((entry) => !headliners.includes(entry))
  return [...headliners, ...rest].map((entry) => (
    entry.roleLabel ? `• ${entry.name} (${entry.roleLabel})` : `• ${entry.name}`
  ))
}

function englishPracticalLines(input: MarketingCopyInput) {
  const time = input.startTime ? `, ${input.startTime.slice(0, 5)}` : ''
  const doors = input.doorsTime ? ` (doors ${input.doorsTime.slice(0, 5)})` : ''
  return [
    `• ${formatLongEnglishDate(input.date)}${time}${doors}`,
    input.venue ? `• ${input.venue}${input.city ? `, ${input.city}` : ''}` : null,
    input.priceLabel ? `• Tickets from ${input.priceLabel}` : null,
  ].filter((line): line is string => line !== null)
}

/**
 * Brødteksten i «Send e-mail about show». Ren tekst: klubben redigerer den i
 * et tekstfelt, og malen i lib/email/show-promo.ts gjør avsnitt av den.
 * Billettlenken står ikke her — malen har en egen knapp.
 */
export function showEmailBody(input: MarketingCopyInput): string {
  return [
    input.description?.trim() || `Join us for ${input.title} — a night of stand-up comedy.`,
    '',
    input.lineup.length > 0 ? 'Line-up' : null,
    ...englishLineupLines(input.lineup),
    input.lineup.length > 0 ? '' : null,
    ...englishPracticalLines(input),
  ]
    .filter((line) => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Tekstfila i «Download all show material»: showteksten og hver komikers bio. */
export function showMaterialText(
  input: MarketingCopyInput & { bios: Array<{ name: string; bio: string | null }> },
): string {
  const bios = input.bios.filter((entry) => entry.bio?.trim())
  return [
    input.title.toUpperCase(),
    '',
    input.description?.trim() || null,
    input.description?.trim() ? '' : null,
    'LINE-UP',
    ...(input.lineup.length > 0 ? englishLineupLines(input.lineup) : ['• To be announced']),
    '',
    'DETAILS',
    ...englishPracticalLines(input),
    input.ticketUrl ? `• Tickets: ${input.ticketUrl}` : null,
    ...(bios.length > 0
      ? ['', 'ABOUT THE COMEDIANS', ...bios.flatMap((entry) => ['', entry.name, entry.bio!.trim()])]
      : []),
  ]
    .filter((line) => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n'
}
