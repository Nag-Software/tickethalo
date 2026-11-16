/**
 * Spot-typene og hvordan en plass matches mot komikerne.
 *
 * Seks standardtyper (Tom, 2026-11-16). Nøklene er det `club_artists.category`
 * og `artists.category` lagrer. De fire første fantes fra før og er beholdt
 * — `stand-up` er nøkkelen til Middle / Feature, `konferansier` til Host / MC
 * og `open mic` til Open Spot — så komikernes roller ikke måtte skrives om,
 * og show som var i gang, matcher som før.
 *
 * I tillegg kan en klubb ha egne typer (`club_spot_types`, migrasjon 100). De
 * lagres med navnet sitt i `category` og matches på navnet. Se
 * `artistMatchesRole` og lib/spot-types.ts.
 */

export type CanonicalArtistRole = 'konferansier' | 'opener' | 'stand-up' | 'showcase' | 'open mic' | 'headliner'

/** Standardlista, i den rekkefølgen en kveld bygges. */
export const ARTIST_ROLE_OPTIONS: Array<{ value: CanonicalArtistRole; label: string }> = [
  { value: 'konferansier', label: 'Host / MC' },
  { value: 'opener', label: 'Opener / Bullet' },
  { value: 'stand-up', label: 'Middle / Feature' },
  { value: 'showcase', label: 'Showcase Spot' },
  { value: 'open mic', label: 'Open Spot' },
  { value: 'headliner', label: 'Closer / Headliner' },
]

const ARTIST_ROLE_LABELS = Object.fromEntries(
  ARTIST_ROLE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<CanonicalArtistRole, string>

/**
 * Det folk skriver, og det gamle plasser heter. «Host», «Headliner»,
 * «Stand-up» og «Open Mic» er navnene på plassene i show som var i gang før
 * de nye navnene — de skal fortsatt treffe.
 */
const ROLE_ALIASES: Record<string, CanonicalArtistRole> = {
  // Host / MC
  konferansier: 'konferansier',
  konferanse: 'konferansier',
  konferans: 'konferansier',
  mc: 'konferansier',
  vert: 'konferansier',
  host: 'konferansier',
  'host mc': 'konferansier',
  // Opener / Bullet — bare den første på lineupen.
  opener: 'opener',
  bullet: 'opener',
  oppvarmer: 'opener',
  'opener bullet': 'opener',
  // Middle / Feature — det som het Stand-up.
  middle: 'stand-up',
  feature: 'stand-up',
  'middle feature': 'stand-up',
  standup: 'stand-up',
  'stand-up': 'stand-up',
  'stand up': 'stand-up',
  klubbkomiker: 'stand-up',
  klubb: 'stand-up',
  support: 'stand-up',
  supporting: 'stand-up',
  spot: 'stand-up',
  // Showcase Spot
  showcase: 'showcase',
  'showcase spot': 'showcase',
  // Open Spot — det som het Open Mic.
  'open spot': 'open mic',
  'open mic': 'open mic',
  openmic: 'open mic',
  'open-mic': 'open mic',
  // Closer / Headliner
  headliner: 'headliner',
  headline: 'headliner',
  closer: 'headliner',
  'closer headliner': 'headliner',
  hoved: 'headliner',
  hovednavn: 'headliner',
  top: 'headliner',
  topper: 'headliner',
}

function tokenizeRoles(input: string | string[]) {
  return (Array.isArray(input) ? input : [input])
    .flatMap((part) => part.split(/[,;|]+/))
    .map((part) => part.trim())
    .filter(Boolean)
}

/** «Host / MC» → «host mc», «open_mic» → «open mic». */
function aliasKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[._/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Standardtypen et navn står for. Tåler både hele etiketten («Host / MC») og
 * hver halvdel («MC»), og de gamle navnene. Null = ikke en standardtype.
 */
export function normalizeArtistRole(value: string | null | undefined): CanonicalArtistRole | null {
  const text = String(value ?? '').trim()
  if (!text) return null

  const whole = ROLE_ALIASES[aliasKey(text)]
  if (whole) return whole

  // «Opener / Bullet» skrevet med en annen skrivemåte: begge halvdelene
  // må peke på samme type, ellers er det ikke én type.
  const halves = text.split('/').map((part) => ROLE_ALIASES[aliasKey(part)]).filter(Boolean)
  if (halves.length > 0 && halves.every((key) => key === halves[0]) && halves.length === text.split('/').length) {
    return halves[0]
  }
  return null
}

export function canonicalRoleValue(value: string | null | undefined) {
  return normalizeArtistRole(value)
}

export function canonicalRoleValues(values: string | string[] | null | undefined) {
  return normalizeArtistRoleList(values)
}

export function formatArtistRole(value: string | null | undefined) {
  const normalized = normalizeArtistRole(value)
  if (!normalized) {
    const fallback = String(value ?? '').trim()
    return fallback || null
  }

  return ARTIST_ROLE_LABELS[normalized]
}

/** Standardtypene i lista, uten duplikater. Egne typer faller bort — se `clubRoleValues`. */
export function normalizeArtistRoleList(values: string | string[] | null | undefined) {
  const tokens = values == null ? [] : tokenizeRoles(values)
  const next: CanonicalArtistRole[] = []

  for (const token of tokens) {
    // «Host / MC» er én type. «host / headliner» er to — da deles det på «/».
    const whole = normalizeArtistRole(token)
    const found = whole ? [whole] : token.split('/').map((part) => normalizeArtistRole(part))
    for (const normalized of found) {
      if (normalized && !next.includes(normalized)) next.push(normalized)
    }
  }

  return next
}

/**
 * Standardtypene og klubbens egne typer i lista, slik `club_artists.category`
 * lagrer dem: nøkkelen for en standardtype, navnet for en egen. Bare egne
 * typer klubben faktisk har (`customNames`), med klubbens skrivemåte.
 */
export function clubRoleValues(values: string | string[] | null | undefined, customNames: readonly string[] = []) {
  const tokens = values == null ? [] : tokenizeRoles(values)
  const custom = new Map(customNames.map((name) => [name.trim().toLowerCase(), name.trim()]))
  const next: string[] = []

  for (const token of tokens) {
    const value = normalizeArtistRole(token) ?? custom.get(token.toLowerCase()) ?? null
    if (value && !next.includes(value)) next.push(value)
  }

  return next
}

/**
 * Rollene klubben har gitt en komiker, slik de vises: etiketten for en
 * standardtype, navnet for klubbens egen (migrasjon 100). I motsetning til
 * `formatArtistRoleList` faller ikke klubbens egne typer bort.
 */
export function clubRoleNames(values: string | string[] | null | undefined) {
  const tokens = values == null ? [] : tokenizeRoles(values)
  const next: string[] = []
  for (const token of tokens) {
    const standard = normalizeArtistRoleList(token)
    const names = standard.length > 0 ? standard.map((key) => ARTIST_ROLE_LABELS[key]) : [token.trim()]
    for (const name of names) if (name && !next.includes(name)) next.push(name)
  }
  return next
}

export function formatArtistRoleList(values: string | string[] | null | undefined) {
  return normalizeArtistRoleList(values).map((value) => ARTIST_ROLE_LABELS[value])
}

export function formatArtistRoleSummary(values: string | string[] | null | undefined, fallback = 'Comedian') {
  const labels = formatArtistRoleList(values)
  return labels.length > 0 ? labels.join(', ') : fallback
}

/**
 * Navnene plassene hadde før de nye typene (migrasjon 100). En plass i et
 * show som var i gang, beholder navnet sitt — også når bookeren lagrer
 * plassen på nytt, og i e-postene til dem som alt er booket.
 */
const LEGACY_SPOT_NAMES = ['Host', 'Headliner', 'Stand-up', 'Open Mic']

/** Om plassen har et navn fra før de nye typene — et show som var i gang. */
export function isLegacySpotName(value: string | null | undefined) {
  const text = String(value ?? '').trim().toLowerCase()
  return LEGACY_SPOT_NAMES.some((name) => name.toLowerCase() === text)
}

/**
 * Navnet en plass lagres og vises med. Et gammelt navn eller en ny etikett
 * står som det er; annen tekst for en standardtype («mc») blir etiketten;
 * alt annet (klubbens egne typer) står som det ble skrevet.
 */
export function canonicalRoleLabel(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const legacy = LEGACY_SPOT_NAMES.find((name) => name.toLowerCase() === text.toLowerCase())
  if (legacy) return legacy
  return formatArtistRole(text) ?? text
}

/** Etiketten til en standardtype. */
export function artistRoleLabel(value: CanonicalArtistRole) {
  return ARTIST_ROLE_LABELS[value]
}

/**
 * Om komikeren kan ta plassen.
 *
 * En standardtype matches på nøkkelen. En klubbs egen type matches på navnet,
 * uten hensyn til store og små bokstaver — det er det `category` lagrer for
 * den (`clubRoleValues`).
 */
export function artistMatchesRole(
  roleName: string | null | undefined,
  artist: { category?: string | string[] | null }
) {
  const normalizedRole = normalizeArtistRole(roleName)
  if (normalizedRole) return normalizeArtistRoleList(artist.category).includes(normalizedRole)

  const name = String(roleName ?? '').trim().toLowerCase()
  if (!name) return false
  const raw = artist.category == null ? [] : tokenizeRoles(artist.category)
  return raw.some((value) => value.toLowerCase() === name)
}

export const ARTIST_ROLE_LABEL_OPTIONS = ARTIST_ROLE_OPTIONS.map((option) => option.label)
