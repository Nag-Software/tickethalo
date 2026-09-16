import { describe, expect, it } from 'vitest'
import { getSessionExpiry, needsSessionRefresh } from '@/lib/session-cookie'

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

describe('session cookie expiry', () => {
  it('reads expires_at from plain JSON', () => {
    expect(getSessionExpiry(JSON.stringify({ expires_at: 1234 }))).toBe(1234)
  })

  it('reads a base64-prefixed session', () => {
    expect(getSessionExpiry(`base64-${encode({ expires_at: 5678 })}`)).toBe(5678)
  })

  it('falls back to the access-token exp claim', () => {
    const token = `header.${encode({ exp: 9012 })}.signature`
    expect(getSessionExpiry(JSON.stringify({ access_token: token }))).toBe(9012)
  })

  it.each(['', 'not-json', '{}', JSON.stringify({ expires_at: 'later' }), JSON.stringify({ access_token: 'broken' })])(
    'returns null for unreadable cookie %j',
    (cookie) => expect(getSessionExpiry(cookie)).toBeNull(),
  )

  it('refreshes an unreadable session', () => {
    expect(needsSessionRefresh('broken', 1_000_000)).toBe(true)
  })

  it('refreshes exactly at the two-minute margin', () => {
    expect(needsSessionRefresh(JSON.stringify({ expires_at: 1120 }), 1_000_000)).toBe(true)
  })

  it('does not refresh outside the margin', () => {
    expect(needsSessionRefresh(JSON.stringify({ expires_at: 1121 }), 1_000_000)).toBe(false)
  })
})
