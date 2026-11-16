/**
 * Type gig — det klubben merker kvelden med, så komikeren vet hva slags
 * kveld det er før de søker (migrasjon 097). Flere kan gjelde samtidig.
 *
 * - Paid / Unpaid: om kvelden betaler komikerne.
 * - Bringer: komikeren tar med publikum.
 * - Stayer: komikeren blir kvelden ut.
 *
 * Fila har ingen serveravhengigheter, så skjemaet i admin kan bruke den.
 */

export const GIG_TYPES = ['paid', 'unpaid', 'bringer', 'stayer'] as const

export type GigType = (typeof GIG_TYPES)[number]

export const GIG_TYPE_LABELS: Record<GigType, string> = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  bringer: 'Bringer',
  stayer: 'Stayer',
}

export function isGigType(value: unknown): value is GigType {
  return typeof value === 'string' && (GIG_TYPES as readonly string[]).includes(value)
}

/**
 * Kjente verdier, uten duplikater, i fast rekkefølge. Tar imot det databasen
 * gir (en liste, eller null fra en rad lest før migrasjonen) og det skjemaet
 * sender (`'paid,stayer'`). Ukjente verdier faller bort.
 */
export function normalizeGigTypes(value: unknown): GigType[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  const picked = new Set(raw.map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : item)))
  return GIG_TYPES.filter((type) => picked.has(type))
}

/** `['paid', 'stayer']` → `['Paid', 'Stayer']`. */
export function gigTypeLabels(value: unknown): string[] {
  return normalizeGigTypes(value).map((type) => GIG_TYPE_LABELS[type])
}

/** `'Paid · Stayer'`, eller null når ingenting er satt. */
export function gigTypesText(value: unknown): string | null {
  const labels = gigTypeLabels(value)
  return labels.length > 0 ? labels.join(' · ') : null
}
