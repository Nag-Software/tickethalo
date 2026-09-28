// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.stubEnv('RESEND_FROM_EMAIL', 'Tickethalo <noreply@tickethalo.test>')

const { FROM_EMAIL, fromWithName } = await import('@/lib/resend')

describe('fromWithName', () => {
  it('puts the club name in front of our verified address, quoted', () => {
    expect(fromWithName('Comedy Club')).toBe('"Comedy Club" <noreply@tickethalo.test>')
  })

  // Uten anførselstegn er et komma et skille mellom to adresser, og Resend
  // avviser hele sendingen — kjøperen får ingen billett.
  it('keeps a legal name with a comma, colon or parenthesis as one sender', () => {
    expect(fromWithName('Comedy Club, Bergen AS')).toBe('"Comedy Club, Bergen AS" <noreply@tickethalo.test>')
    expect(fromWithName('Latter (Oslo): Stand-up')).toBe('"Latter (Oslo): Stand-up" <noreply@tickethalo.test>')
  })

  it('strips characters that would break out of the quotes or the address', () => {
    expect(fromWithName('Evil "Club" <admin@evil.test>')).toBe('"Evil Club admin@evil.test" <noreply@tickethalo.test>')
  })

  it.each([null, undefined, '', '   '])('falls back to the plain from address for %j', (name) => {
    expect(fromWithName(name)).toBe(FROM_EMAIL)
  })
})
