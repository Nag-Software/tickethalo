export type CanonicalArtistRole = 'headliner' | 'konferansier' | 'klubbspot' | 'stand-up' | 'open mic'

export const ARTIST_ROLE_OPTIONS: Array<{ value: CanonicalArtistRole; label: string }> = [
  { value: 'headliner', label: 'Headliner' },
  { value: 'konferansier', label: 'Konferansier' },
  { value: 'klubbspot', label: 'Klubbspot' },
  { value: 'stand-up', label: 'Stand-up' },
  { value: 'open mic', label: 'Open Mic' },
]

const ARTIST_ROLE_LABELS: Record<CanonicalArtistRole, string> = {
  headliner: 'Headliner',
  konferansier: 'Konferansier',
  klubbspot: 'Klubbspot',
  'stand-up': 'Stand-up',
  'open mic': 'Open Mic',
}

const ROLE_ALIASES: Record<string, CanonicalArtistRole> = {
  headliner: 'headliner',
  headline: 'headliner',
  hoved: 'headliner',
  hovednavn: 'headliner',
  top: 'headliner',
  topper: 'headliner',
  konferansier: 'konferansier',
  konferanse: 'konferansier',
  konferans: 'konferansier',
  mc: 'konferansier',
  vert: 'konferansier',
  host: 'konferansier',
  standup: 'stand-up',
  'stand-up': 'stand-up',
  klubbspot: 'klubbspot',
  'klubb spot': 'klubbspot',
  klubbkomiker: 'stand-up',
  klubb: 'stand-up',
  support: 'stand-up',
  supporting: 'stand-up',
  opener: 'stand-up',
  oppvarmer: 'stand-up',
  spot: 'stand-up',
  'open mic': 'open mic',
  openmic: 'open mic',
  'open-mic': 'open mic',
  open_mic: 'open mic',
}

function tokenizeRoles(input: string | string[]) {
  return (Array.isArray(input) ? input : [input])
    .flatMap((part) => part.split(/[\/,;|]+/))
    .map((part) => part.trim())
    .filter(Boolean)
}

export function normalizeArtistRole(value: string | null | undefined): CanonicalArtistRole | null {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return null

  const normalized = text
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return ROLE_ALIASES[normalized] ?? null
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

export function normalizeArtistRoleList(values: string | string[] | null | undefined) {
  const tokens = values == null ? [] : tokenizeRoles(values)
  const next: CanonicalArtistRole[] = []

  for (const token of tokens) {
    const normalized = normalizeArtistRole(token)
    if (normalized && !next.includes(normalized)) {
      next.push(normalized)
    }
  }

  return next
}

export function formatArtistRoleList(values: string | string[] | null | undefined) {
  return normalizeArtistRoleList(values).map((value) => ARTIST_ROLE_LABELS[value])
}

export function formatArtistRoleSummary(values: string | string[] | null | undefined, fallback = 'Komiker') {
  const labels = formatArtistRoleList(values)
  return labels.length > 0 ? labels.join(', ') : fallback
}

export function canonicalRoleLabel(value: string | null | undefined) {
  const formatted = formatArtistRole(value)
  return formatted ?? (String(value ?? '').trim() || null)
}

export function artistMatchesRole(
  roleName: string | null | undefined,
  artist: { category?: string | string[] | null }
) {
  const normalizedRole = normalizeArtistRole(roleName)
  if (!normalizedRole) return false

  const artistRoles = normalizeArtistRoleList(artist.category)

  return artistRoles.includes(normalizedRole)
}

export const ARTIST_ROLE_LABEL_OPTIONS = ARTIST_ROLE_OPTIONS.map((option) => option.label)
