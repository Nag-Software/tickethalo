/**
 * WhatsApp for lineupen — uten API.
 *
 * Meta lar bare offisielle bedriftskontoer (blått merke) lage grupper fra
 * en server, og ingen lenke åpner en ny gruppe med deltakerne ferdig lagt
 * inn. Klubben lager derfor gruppen selv, og vi gjør resten lett: navnet,
 * teksten som festes øverst, én lenke per komiker som åpner chatten, og
 * invitasjonslenken sendt ut til lineupen.
 *
 * Ingen Node-avhengigheter: både server og klient bruker den.
 */

/**
 * Landskoden når nummeret skrives uten. Komikerens land avgjør; et land som
 * ikke står her må skrives med `+`.
 */
const CALLING_CODES: Record<string, string> = {
  NO: '47',
  SE: '46',
  DK: '45',
  FI: '358',
  IS: '354',
  GB: '44',
  IE: '353',
  DE: '49',
  NL: '31',
  PL: '48',
  ES: '34',
  FR: '33',
  US: '1',
  CA: '1',
}

/** E.164: høyst 15 sifre med landskoden. Under 8 er ikke et mobilnummer noe sted. */
const MIN_DIGITS = 8
const MAX_DIGITS = 15

/**
 * Nummeret slik wa.me vil ha det: landskode og nummer, bare sifre.
 *
 * Tåler det folk faktisk skriver — mellomrom, bindestrek, parentes, `+47`,
 * `0047` og et norsk nummer uten landskode. Null når det ikke kan være et
 * nummer.
 */
export function normalizeWhatsAppNumber(input: string | null | undefined, country?: string | null): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  if (/[^\d\s+\-().]/.test(raw)) return null

  const digitsOnly = raw.replace(/\D/g, '')
  let digits: string
  if (raw.startsWith('+')) {
    digits = digitsOnly
  } else if (digitsOnly.startsWith('00')) {
    digits = digitsOnly.slice(2)
  } else {
    const code = CALLING_CODES[(country ?? 'NO').toUpperCase()]
    if (!code) return null
    // Skrevet med landskoden, men uten `+`: 4791234567.
    if (digitsOnly.startsWith(code) && digitsOnly.length >= code.length + MIN_DIGITS) {
      digits = digitsOnly
    } else {
      // Den innenlandske nullen (070 i Sverige, 07 i Storbritannia) faller bort med landskoden.
      digits = code + digitsOnly.replace(/^0+/, '')
    }
  }

  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS || digits.startsWith('0')) return null
  return digits
}

/** «+47 91234567» — til visning. Lagres alltid som rene sifre. */
export function formatWhatsAppNumber(digits: string | null | undefined) {
  return digits ? `+${digits}` : ''
}

/**
 * Lenken som åpner en chat med komikeren. Klubben trykker på den selv;
 * det er den eneste URL-en et telefonnummer står i.
 */
export function waMeLink(digits: string, text?: string | null) {
  const base = `https://wa.me/${digits.replace(/\D/g, '')}`
  return text?.trim() ? `${base}?text=${encodeURIComponent(text.trim())}` : base
}

const INVITE_CODE = /^[A-Za-z0-9]{16,40}$/

/**
 * Invitasjonslenken til en gruppe, i sin rene form — eller null om det ikke
 * er en. Bare chat.whatsapp.com godtas: lenken sendes til hele lineupen, og
 * skal ikke kunne bli en lenke til hvor som helst. Spørsmålsdelen
 * (`?mode=…`) som nyere versjoner legger på, fjernes.
 */
export function normalizeWhatsAppInviteLink(input: string | null | undefined): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.hostname.toLowerCase() !== 'chat.whatsapp.com') return null
  if (url.username || url.password || url.port) return null

  const parts = url.pathname.split('/').filter(Boolean)
  const code = parts[0] === 'invite' ? parts[1] : parts[0]
  if (!code || parts.length > (parts[0] === 'invite' ? 2 : 1) || !INVITE_CODE.test(code)) return null
  return `https://chat.whatsapp.com/${code}`
}

/** WhatsApp kutter gruppenavnet ved 100 tegn. */
const GROUP_NAME_MAX = 100

/** «Friday Laughs 24 Oct» — navnet og datoen, som Tom ba om. */
export function lineupGroupName(title: string, date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  const label = match
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)))
    : date
  const suffix = label ? ` ${label}` : ''
  const room = GROUP_NAME_MAX - suffix.length
  const name = title.trim().length > room ? `${title.trim().slice(0, room - 1).trimEnd()}…` : title.trim()
  return `${name}${suffix}`
}
