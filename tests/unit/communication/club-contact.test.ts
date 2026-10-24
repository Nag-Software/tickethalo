// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { clubContactEmail, parseClubContact } from '@/lib/club-contact'

describe('parseClubContact', () => {
  it('stores the phone as digits with the country code, +47 when none is typed', () => {
    expect(parseClubContact({ email: '', phone: '912 34 567' }, 'NO')).toEqual({ ok: true, contact_email: null, contact_phone: '4791234567' })
    expect(parseClubContact({ email: '', phone: '+47 912 34 567' }, 'NO')).toMatchObject({ contact_phone: '4791234567' })
    expect(parseClubContact({ email: '', phone: '0046 70 123 45 67' }, 'NO')).toMatchObject({ contact_phone: '46701234567' })
    expect(parseClubContact({ email: '', phone: '91234567' }, null)).toMatchObject({ contact_phone: '4791234567' })
  })

  it('uses the club’s own country code for a number without one', () => {
    expect(parseClubContact({ email: '', phone: '070 123 45 67' }, 'SE')).toMatchObject({ contact_phone: '46701234567' })
  })

  it('keeps the email as typed, trimmed, and empty fields as null', () => {
    expect(parseClubContact({ email: ' Tom@Cronch.no ', phone: ' ' }, 'NO')).toEqual({ ok: true, contact_email: 'Tom@Cronch.no', contact_phone: null })
    expect(parseClubContact({ email: null, phone: undefined }, 'NO')).toEqual({ ok: true, contact_email: null, contact_phone: null })
  })

  it('refuses what cannot be an email or a phone number', () => {
    expect(parseClubContact({ email: 'tom@cronch', phone: '' }, 'NO')).toMatchObject({ ok: false, error: expect.stringMatching(/email/) })
    expect(parseClubContact({ email: '', phone: '123' }, 'NO')).toMatchObject({ ok: false, error: expect.stringMatching(/country code/) })
    expect(parseClubContact({ email: '', phone: 'call me' }, 'NO')).toMatchObject({ ok: false })
  })
})

describe('clubContactEmail', () => {
  it('is the contact email, or the ticket buyers’ address when it is empty', () => {
    expect(clubContactEmail({ contact_email: 'booking@cronch.no', support_email: 'hei@cronch.no' })).toBe('booking@cronch.no')
    expect(clubContactEmail({ contact_email: ' ', support_email: 'hei@cronch.no' })).toBe('hei@cronch.no')
    expect(clubContactEmail({ contact_email: null, support_email: null })).toBeNull()
  })
})
