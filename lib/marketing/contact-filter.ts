import type { ContactStatusFilter } from './contact-export'

/**
 * Filteret og søket på Marketing-siden, brukt både av lista, tellerne og
 * eksporten — «Export CSV» skal gi det klubben ser.
 */

export const CONTACT_FILTERS: { value: ContactStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'subscribed', label: 'Subscribed' },
  { value: 'unsubscribed', label: 'Unsubscribed' },
  { value: 'ads', label: 'Ads consent' },
]

export function toContactFilter(value: string | null | undefined): ContactStatusFilter {
  return value === 'subscribed' || value === 'unsubscribed' || value === 'ads' ? value : 'all'
}

/**
 * `.or()` tar en rå filterstreng. Tegnene som betyr noe i den (komma,
 * parentes, jokertegn) fjernes fra søket, så det bare kan være et søk.
 */
export function contactSearchTerm(query: string | null | undefined): string {
  return (query ?? '').trim().slice(0, 100).replace(/[,()*%"\\]/g, ' ').trim()
}

// Metodene på en PostgREST-spørring returnerer spørringen selv.
type Filterable<Q> = {
  is(column: string, value: null): Q
  not(column: string, operator: string, value: unknown): Q
  or(filters: string): Q
}

export function applyContactFilter<Q extends Filterable<Q>>(query: Q, filter: ContactStatusFilter, term = ''): Q {
  let next = query
  if (filter === 'subscribed') next = next.is('unsubscribed_at', null)
  if (filter === 'unsubscribed') next = next.not('unsubscribed_at', 'is', null)
  // Samme regel som `isAdsAudience`.
  if (filter === 'ads') {
    next = next.not('ads_consent_at', 'is', null).is('ads_withdrawn_at', null).is('unsubscribed_at', null)
  }
  if (term) next = next.or(`email.ilike.*${term}*,name.ilike.*${term}*,phone.ilike.*${term}*`)
  return next
}
