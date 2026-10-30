import { describe, expect, it } from 'vitest'
import { formatDuration, parseDuration } from '@/lib/spot-duration'
import { offerDetails } from '@/lib/booking-engine'

describe('formatDuration', () => {
  it('writes minutes the way the line-up shows them', () => {
    expect(formatDuration(15)).toBe('15 min')
    expect(formatDuration(1)).toBe('1 min')
  })

  it('says nothing when the spot has no duration', () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(undefined)).toBeNull()
    expect(formatDuration(0)).toBeNull()
    expect(formatDuration(Number.NaN)).toBeNull()
  })
})

describe('parseDuration', () => {
  it('reads whole minutes from the editor', () => {
    expect(parseDuration('20')).toBe(20)
    expect(parseDuration(' 7 ')).toBe(7)
  })

  it('treats an empty field as not set', () => {
    expect(parseDuration('')).toBeNull()
    expect(parseDuration(null)).toBeNull()
    expect(parseDuration('   ')).toBeNull()
  })

  it('refuses anything outside 1–180 whole minutes', () => {
    expect(() => parseDuration('0')).toThrow(/between 1 and 180/)
    expect(() => parseDuration('181')).toThrow(/between 1 and 180/)
    expect(() => parseDuration('12.5')).toThrow()
    expect(() => parseDuration('ten')).toThrow()
  })
})

describe('offerDetails', () => {
  const show = { start_time: '20:00:00', venue_name: 'Crønch', venue_address: null, currency: 'NOK' }
  const fee = { compensation_type: 'fixed' as const, compensation_amount: 150000, compensation_percent: null }

  it('carries the spot type and the minutes into the offer', () => {
    const details = offerDetails(show, { role_name: 'Headliner', duration_minutes: 20, ...fee })
    expect(details.role_name).toBe('Headliner')
    expect(details.duration_label).toBe('20 min')
  })

  it('leaves the duration out when the spot has none', () => {
    expect(offerDetails(show, { role_name: 'Host', duration_minutes: null, ...fee }).duration_label).toBeNull()
    expect(offerDetails(show, { role_name: 'Host', ...fee }).duration_label).toBeNull()
  })
})
