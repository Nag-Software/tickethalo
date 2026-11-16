import { ARTIST_ROLE_OPTIONS, normalizeArtistRole, type CanonicalArtistRole } from '@/lib/artist-roles'

/**
 * Klubbens spot-typer, uten databasen (migrasjon 100).
 *
 * Klubbene velger fra standardlista og kan legge til egne typer (Tom,
 * 2026-11-16). Standardtypene kan skrus av og flyttes, men ikke døpes om —
 * da kan de sammenlignes på tvers av klubbene. Egne typer gjelder bare
 * klubben som laget dem.
 *
 * Fila har ingen serveravhengigheter, så skjemaene i admin kan bruke den.
 * Oppslag og lagring står i lib/spot-types-data.ts.
 */

export type ClubSpotType = {
  id: string
  club_id: string
  /** Null = klubbens egen type. */
  standard_key: CanonicalArtistRole | null
  name: string
  position: number
  active: boolean
  /** Tilbudet sier at plassen er ubetalt. */
  is_unpaid: boolean
  /** Honoraret en ny plass av typen får, i prosent av billettsalget. */
  default_compensation_percent: number | null
}

// Prosentene standard-lineupen alltid har brukt. Open Spot har ikke honorar.
const STANDARD_PERCENT: Record<CanonicalArtistRole, number> = {
  konferansier: 15,
  opener: 10,
  'stand-up': 10,
  showcase: 10,
  'open mic': 0,
  headliner: 15,
}

/** Standardlista slik en ny klubb får den. Samme verdier som migrasjon 100. */
export const STANDARD_SPOT_TYPES: Array<{
  standard_key: CanonicalArtistRole
  name: string
  position: number
  is_unpaid: boolean
  default_compensation_percent: number
}> = ARTIST_ROLE_OPTIONS.map((option, index) => ({
  standard_key: option.value,
  name: option.label,
  position: index + 1,
  is_unpaid: option.value === 'open mic',
  default_compensation_percent: STANDARD_PERCENT[option.value],
}))


export const MAX_SPOT_TYPE_NAME = 40

/** Typen en plass med dette navnet hører til. Null = ingen av klubbens typer. */
export function spotTypeForRole<T extends Pick<ClubSpotType, 'standard_key' | 'name'>>(
  types: readonly T[],
  roleName: string | null | undefined,
): T | null {
  const standard = normalizeArtistRole(roleName)
  if (standard) return types.find((type) => type.standard_key === standard) ?? null
  const name = String(roleName ?? '').trim().toLowerCase()
  if (!name) return null
  return types.find((type) => type.standard_key == null && type.name.trim().toLowerCase() === name) ?? null
}

/**
 * Teksten tilbudet får når plassen er ubetalt. Toms ordlyd for Open Spot;
 * en egen type får sitt eget navn i samme setning.
 */
export function unpaidSpotNote(typeName: string): string {
  const name = typeName.trim() || 'Open Spot'
  const plural = name.endsWith('s') ? name : `${name}s`
  return `We’d love to have you on the lineup for ${articleFor(name)} ${name}. Just so there are no surprises, all ${plural} are unpaid sets.`
}

function articleFor(word: string) {
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}

/**
 * Notatet for en plass, eller null når plassen ikke er ubetalt.
 *
 * Uten klubbens typer (en klubb som ikke er satt opp ennå) gjelder
 * standarden: Open Spot er ubetalt, resten er det ikke.
 */
export function unpaidNoteForRole(
  types: readonly Pick<ClubSpotType, 'standard_key' | 'name' | 'is_unpaid'>[] | null,
  roleName: string | null | undefined,
): string | null {
  const type = types ? spotTypeForRole(types, roleName) : null
  if (type) return type.is_unpaid ? unpaidSpotNote(type.name) : null
  return normalizeArtistRole(roleName) === 'open mic' ? unpaidSpotNote('Open Spot') : null
}

/** De aktive typene i klubbens rekkefølge. */
export function activeSpotTypes<T extends Pick<ClubSpotType, 'active' | 'position' | 'name'>>(types: readonly T[]): T[] {
  return [...types].filter((type) => type.active).sort((left, right) => left.position - right.position || left.name.localeCompare(right.name))
}

/** Navnene på klubbens egne typer — det `clubRoleValues` godtar i tillegg til standarden. */
export function customSpotTypeNames(types: readonly Pick<ClubSpotType, 'standard_key' | 'name'>[]): string[] {
  return types.filter((type) => type.standard_key == null).map((type) => type.name)
}

/** Om to plassnavn er samme type — «Host» og «Host / MC» er det. */
export function sameSpotType(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizeArtistRole(left)
  const b = normalizeArtistRole(right)
  if (a || b) return a === b
  return String(left ?? '').trim().toLowerCase() === String(right ?? '').trim().toLowerCase()
}

/**
 * Valgene i rollemenyen: klubbens aktive typer, og plassens nåværende navn
 * først når det ikke er blant dem — et gammelt navn («Stand-up») eller en
 * type klubben har skrudd av. Ellers ville menyen vist feil valg.
 */
export function spotTypeMenuOptions(typeNames: readonly string[], current?: string | null): string[] {
  const now = String(current ?? '').trim()
  if (!now || typeNames.some((name) => name.trim().toLowerCase() === now.toLowerCase())) return [...typeNames]
  return [now, ...typeNames]
}

/**
 * Valgene i «Book them as»: klubbens aktive typer, og en type klubben har
 * skrudd av når komikeren alt er merket med den — ellers ville en lagring
 * stille fjernet merket. `value` er det `club_artists.category` lagrer.
 */
export function bookAsOptions(
  types: readonly Pick<ClubSpotType, 'standard_key' | 'name' | 'active' | 'position'>[],
  current: readonly string[] = [],
): Array<{ value: string; label: string }> {
  const valueOf = (type: Pick<ClubSpotType, 'standard_key' | 'name'>) => type.standard_key ?? type.name.trim()
  const list = types.length > 0
    ? [...types]
      .filter((type) => type.active || current.includes(valueOf(type)))
      .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name))
      .map((type) => ({ value: valueOf(type), label: type.name }))
    : ARTIST_ROLE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))
  return list
}
