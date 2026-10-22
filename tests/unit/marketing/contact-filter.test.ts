// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { applyContactFilter, contactSearchTerm, toContactFilter } from '@/lib/marketing/contact-filter'

/** Skriver ned kallene, så filteret kan sammenlignes med `isAdsAudience`. */
function recorder() {
  const calls: string[] = []
  const query = {
    is(column: string, value: null) {
      calls.push(`${column} is ${value}`)
      return query
    },
    not(column: string, operator: string, value: unknown) {
      calls.push(`${column} not ${operator} ${value}`)
      return query
    },
    or(filters: string) {
      calls.push(`or ${filters}`)
      return query
    },
  }
  return { query, calls }
}

describe('contact filter', () => {
  it('reads the filter from the URL and falls back to all', () => {
    expect(toContactFilter('ads')).toBe('ads')
    expect(toContactFilter('subscribed')).toBe('subscribed')
    expect(toContactFilter('everyone')).toBe('all')
    expect(toContactFilter(null)).toBe('all')
  })

  it('takes ads consent to mean a yes that is neither withdrawn nor unsubscribed', () => {
    const { query, calls } = recorder()
    applyContactFilter(query, 'ads')
    expect(calls).toEqual(['ads_consent_at not is null', 'ads_withdrawn_at is null', 'unsubscribed_at is null'])
  })

  it('adds the search to the status filter', () => {
    const { query, calls } = recorder()
    applyContactFilter(query, 'unsubscribed', 'ola')
    expect(calls).toEqual(['unsubscribed_at not is null', 'or email.ilike.*ola*,name.ilike.*ola*,phone.ilike.*ola*'])
  })

  it('strips what would change the raw filter string', () => {
    expect(contactSearchTerm(' ola,name.eq.x) ')).toBe('ola name.eq.x')
    expect(contactSearchTerm('a*%"\\b')).toBe('a    b')
    expect(contactSearchTerm('x'.repeat(200))).toHaveLength(100)
  })
})
