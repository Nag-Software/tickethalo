// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  isUnsubscribeToken,
  listUnsubscribeHeaders,
  maskEmail,
  oneClickUnsubscribeUrl,
  tokenFromUnsubscribeUrl,
  unsubscribePageUrl,
} from '@/lib/marketing/unsubscribe'

const token = 'a'.repeat(32) + '0123456789abcdef'.repeat(2)

describe('unsubscribe tokens', () => {
  it('accepts the 64 hex characters migration 077 generates, nothing else', () => {
    expect(isUnsubscribeToken(token)).toBe(true)
    expect(isUnsubscribeToken(token.toUpperCase())).toBe(false)
    expect(isUnsubscribeToken(token.slice(1))).toBe(false)
    expect(isUnsubscribeToken(`${token.slice(1)}'`)).toBe(false)
    expect(isUnsubscribeToken(undefined)).toBe(false)
  })

  it('builds the page link and the one-click link', () => {
    expect(unsubscribePageUrl('https://tickethalo.com/', token)).toBe(`https://tickethalo.com/unsubscribe/${token}`)
    expect(oneClickUnsubscribeUrl('https://tickethalo.com', token)).toBe(`https://tickethalo.com/api/unsubscribe/${token}`)
  })

  it('reads the token back out of a stored page link', () => {
    expect(tokenFromUnsubscribeUrl(unsubscribePageUrl('https://tickethalo.com', token))).toBe(token)
    expect(tokenFromUnsubscribeUrl('https://tickethalo.com/unsubscribe/nope')).toBeNull()
    expect(tokenFromUnsubscribeUrl(null)).toBeNull()
  })

  it('sends the RFC 8058 headers Gmail and Yahoo require', () => {
    expect(listUnsubscribeHeaders('https://tickethalo.com', token)).toEqual({
      'List-Unsubscribe': `<https://tickethalo.com/api/unsubscribe/${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })
})

describe('maskEmail', () => {
  it('shows enough to recognise the address, not all of it', () => {
    expect(maskEmail('casper@nagsoftware.no')).toBe('c•••••@nagsoftware.no')
    expect(maskEmail('a@b.no')).toBe('a•••@b.no')
    expect(maskEmail('averyveryverylongname@x.no')).toBe('a••••••••@x.no')
  })
})
