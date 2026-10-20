// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/headshot-check', () => ({
  isApprovedHeadshot: (_image: Buffer, token: string | undefined) => token === 'approved',
}))

import { parseArtistSignupForm, toSignupErrorCode } from '@/lib/artist-signup-form'

/**
 * Registreringsskjemaet brukes både av den offentlige registreringen og av
 * «Create comedian profile» under My club. Det siste lager ingen innlogging,
 * så passordet hverken kreves eller leses.
 */

function form(overrides: Record<string, string | null> = {}) {
  const data = new FormData()
  const values: Record<string, string | null> = {
    full_name: 'Kari Komiker',
    email: ' Kari@Mail.test ',
    password: 'hemmelig123',
    password_confirm: 'hemmelig123',
    phone: '+47 99999999',
    city: 'Oslo',
    country: 'NO',
    gender: 'woman',
    language: 'no',
    profile_image_check: 'approved',
    ...overrides,
  }
  for (const [key, value] of Object.entries(values)) if (value !== null) data.append(key, value)
  data.append('profile_image_file', new File([new Uint8Array([1, 2, 3])], 'me.jpg', { type: 'image/jpeg' }))
  return data
}

async function codeFor(promise: Promise<unknown>) {
  try {
    await promise
    return 'ok'
  } catch (error) {
    return toSignupErrorCode(error)
  }
}

describe('parseArtistSignupForm', () => {
  it('reads a new account with its password', async () => {
    const parsed = await parseArtistSignupForm(form(), 'new-account')
    expect(parsed.email).toBe('kari@mail.test')
    expect(parsed.password).toBe('hemmelig123')
    expect(parsed.profile).toMatchObject({ full_name: 'Kari Komiker', city: 'Oslo', country: 'NO', gender: 'woman' })
  })

  it('still demands matching passwords for a new account', async () => {
    await expect(codeFor(parseArtistSignupForm(form({ password_confirm: 'annet' }), 'new-account'))).resolves.toBe('password_mismatch')
    await expect(codeFor(parseArtistSignupForm(form({ password: null }), 'new-account'))).resolves.toBe('missing')
  })

  it('needs no password on an existing login, and never passes one on', async () => {
    const parsed = await parseArtistSignupForm(form({ password: null, password_confirm: null }), 'existing-account')
    expect(parsed.password).toBeUndefined()
    expect(parsed.email).toBe('kari@mail.test')
  })

  it('checks the offer email itself on an existing login, since no login is created to check it', async () => {
    await expect(codeFor(parseArtistSignupForm(form({ email: 'not-an-email' }), 'existing-account'))).resolves.toBe('invalid_email')
  })

  it('requires an approved headshot either way', async () => {
    await expect(codeFor(parseArtistSignupForm(form({ profile_image_check: 'forged' }), 'existing-account'))).resolves.toBe('photo_unchecked')
  })
})
