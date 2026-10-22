// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  formatWhatsAppNumber,
  lineupGroupName,
  normalizeWhatsAppInviteLink,
  normalizeWhatsAppNumber,
  waMeLink,
} from '@/lib/whatsapp'

describe('normalizeWhatsAppNumber', () => {
  it('adds the Norwegian country code to an eight-digit number', () => {
    expect(normalizeWhatsAppNumber('912 34 567', 'NO')).toBe('4791234567')
  })

  it('accepts +, 00 and the code written without +', () => {
    expect(normalizeWhatsAppNumber('+47 912 34 567', 'NO')).toBe('4791234567')
    expect(normalizeWhatsAppNumber('0047 91234567', 'NO')).toBe('4791234567')
    expect(normalizeWhatsAppNumber('47 91 23 45 67', 'NO')).toBe('4791234567')
  })

  it('uses the comedian’s country and drops the domestic zero', () => {
    expect(normalizeWhatsAppNumber('070-123 45 67', 'SE')).toBe('46701234567')
    expect(normalizeWhatsAppNumber('(07700) 900123', 'GB')).toBe('447700900123')
  })

  it('defaults to Norway when no country is set', () => {
    expect(normalizeWhatsAppNumber('91234567', null)).toBe('4791234567')
  })

  it('keeps a + number from another country as it is', () => {
    expect(normalizeWhatsAppNumber('+46 70 123 45 67', 'NO')).toBe('46701234567')
  })

  it('rejects what cannot be a number', () => {
    expect(normalizeWhatsAppNumber('', 'NO')).toBeNull()
    expect(normalizeWhatsAppNumber('call me', 'NO')).toBeNull()
    expect(normalizeWhatsAppNumber('123', 'NO')).toBeNull()
    expect(normalizeWhatsAppNumber('+1234567890123456', 'NO')).toBeNull()
    expect(normalizeWhatsAppNumber('91234567', 'ZZ')).toBeNull()
  })
})

describe('waMeLink', () => {
  it('puts only digits in the path and encodes the text', () => {
    expect(waMeLink('4791234567')).toBe('https://wa.me/4791234567')
    expect(waMeLink('+47 912 34 567', 'Hi Anna! Friday & Saturday?')).toBe(
      'https://wa.me/4791234567?text=Hi%20Anna!%20Friday%20%26%20Saturday%3F',
    )
  })

  it('leaves out an empty text', () => {
    expect(waMeLink('4791234567', '   ')).toBe('https://wa.me/4791234567')
  })

  it('formats the stored digits for display', () => {
    expect(formatWhatsAppNumber('4791234567')).toBe('+4791234567')
    expect(formatWhatsAppNumber(null)).toBe('')
  })
})

describe('normalizeWhatsAppInviteLink', () => {
  const code = 'AbCdEfGhIjKlMnOpQrStUv'

  it('accepts the link WhatsApp copies, with or without the scheme', () => {
    expect(normalizeWhatsAppInviteLink(`https://chat.whatsapp.com/${code}`)).toBe(`https://chat.whatsapp.com/${code}`)
    expect(normalizeWhatsAppInviteLink(`chat.whatsapp.com/${code}`)).toBe(`https://chat.whatsapp.com/${code}`)
    expect(normalizeWhatsAppInviteLink(`  http://CHAT.whatsapp.com/${code}  `)).toBe(`https://chat.whatsapp.com/${code}`)
  })

  it('drops the query newer versions add, and accepts /invite/', () => {
    expect(normalizeWhatsAppInviteLink(`https://chat.whatsapp.com/${code}?mode=ems_copy_t`)).toBe(`https://chat.whatsapp.com/${code}`)
    expect(normalizeWhatsAppInviteLink(`https://chat.whatsapp.com/invite/${code}`)).toBe(`https://chat.whatsapp.com/${code}`)
  })

  it('rejects any other host, path or credentials', () => {
    expect(normalizeWhatsAppInviteLink(`https://chat.whatsapp.com.evil.test/${code}`)).toBeNull()
    expect(normalizeWhatsAppInviteLink(`https://evil.test/chat.whatsapp.com/${code}`)).toBeNull()
    expect(normalizeWhatsAppInviteLink(`https://user@chat.whatsapp.com/${code}`)).toBeNull()
    expect(normalizeWhatsAppInviteLink(`https://chat.whatsapp.com/${code}/extra`)).toBeNull()
    expect(normalizeWhatsAppInviteLink('https://chat.whatsapp.com/short')).toBeNull()
    expect(normalizeWhatsAppInviteLink(`javascript:alert(1)//chat.whatsapp.com/${code}`)).toBeNull()
    expect(normalizeWhatsAppInviteLink('https://wa.me/4791234567')).toBeNull()
    expect(normalizeWhatsAppInviteLink('')).toBeNull()
  })
})

describe('lineupGroupName', () => {
  it('is the show name and the date', () => {
    expect(lineupGroupName('Friday Laughs', '2026-10-24')).toBe('Friday Laughs 24 Oct')
  })

  it('stays within WhatsApp’s 100 characters', () => {
    const name = lineupGroupName('A'.repeat(150), '2026-10-24')
    expect(name.length).toBeLessThanOrEqual(100)
    expect(name.endsWith('… 24 Oct')).toBe(true)
  })
})
