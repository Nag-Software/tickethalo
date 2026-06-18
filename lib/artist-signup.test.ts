import { describe, expect, it } from 'vitest'
import {
  buildSignupFieldCompletion,
  createTestImageFile,
  createValidSignupFormData,
  getSignupProgress,
  getSignupRequiredFields,
  isYouTubeUrl,
  parseArtistSignupFormData,
  toSignupErrorCode,
  validateArtistSignupForm,
} from './artist-signup'

describe('artist signup required fields', () => {
  it('requires password on new signup but not when completing profile', () => {
    expect(getSignupRequiredFields(false).map((field) => field.id)).toEqual([
      'full_name',
      'stage_name',
      'email',
      'password',
      'profile_images',
      'phone',
      'language',
      'gender',
    ])
    expect(getSignupRequiredFields(true).map((field) => field.id)).toEqual([
      'full_name',
      'stage_name',
      'email',
      'profile_images',
      'phone',
      'language',
      'gender',
    ])
  })

  it('tracks progress from the same field set as server validation', () => {
    const emptyValues = buildSignupFieldCompletion(undefined, false)
    const progress = getSignupProgress(emptyValues, false)

    expect(progress.total).toBe(8)
    expect(progress.completed).toBe(0)
    expect(progress.isComplete).toBe(false)
    expect(progress.missing.map((field) => field.id)).toEqual([
      'full_name',
      'stage_name',
      'email',
      'password',
      'profile_images',
      'phone',
      'language',
      'gender',
    ])
  })

  it('marks completion mode password as satisfied by default', () => {
    const values = buildSignupFieldCompletion(undefined, true)
    const progress = getSignupProgress(values, true)

    expect(progress.missing.map((field) => field.id)).not.toContain('password')
    expect(progress.total).toBe(7)
  })
})

describe('validateArtistSignupForm', () => {
  it('accepts a complete new signup payload', () => {
    const formData = createValidSignupFormData()

    expect(() =>
      validateArtistSignupForm(formData, { completionMode: false, hasExistingProfileImage: false }),
    ).not.toThrow()
  })

  it('does not require youtube', () => {
    const formData = createValidSignupFormData()
    formData.delete('youtube')

    expect(() =>
      validateArtistSignupForm(formData, { completionMode: false, hasExistingProfileImage: false }),
    ).not.toThrow()
  })

  it('rejects missing profile images unless an existing image is kept', () => {
    const formData = createValidSignupFormData()
    formData.delete('profile_image_files')

    expect(() =>
      validateArtistSignupForm(formData, { completionMode: false, hasExistingProfileImage: false }),
    ).toThrow('Required fields missing')

    expect(() =>
      validateArtistSignupForm(formData, { completionMode: true, hasExistingProfileImage: true }),
    ).not.toThrow()
  })

  it('rejects short passwords on new signup', () => {
    const formData = createValidSignupFormData({ password: 'abc' })

    expect(() =>
      validateArtistSignupForm(formData, { completionMode: false, hasExistingProfileImage: false }),
    ).toThrow('Password must be at least 8 characters')
  })

  it('allows empty password in completion mode but validates optional new password length', () => {
    const formData = createValidSignupFormData({ password: '' })

    expect(() =>
      validateArtistSignupForm(formData, { completionMode: true, hasExistingProfileImage: false }),
    ).not.toThrow()

    formData.set('password', 'short')
    expect(() =>
      validateArtistSignupForm(formData, { completionMode: true, hasExistingProfileImage: false }),
    ).toThrow('Password must be at least 8 characters')
  })

  it('validates youtube only when provided', () => {
    const formData = createValidSignupFormData({ youtube: 'https://example.com/not-youtube' })

    expect(() =>
      validateArtistSignupForm(formData, { completionMode: false, hasExistingProfileImage: false }),
    ).toThrow('Invalid YouTube URL')
  })
})

describe('parseArtistSignupFormData', () => {
  it('normalizes email and parses categories and social links', () => {
    const formData = createValidSignupFormData({
      email: '  OLA@Example.COM ',
      category: 'Stand-up',
      instagram: 'https://instagram.com/ola',
      youtube: 'https://youtube.com/watch?v=abc123',
    })
    formData.append('profile_image_files', createTestImageFile('profile-b.jpg'))
    formData.set('primary_profile_image_index', '1')

    const parsed = parseArtistSignupFormData(formData)

    expect(parsed.email).toBe('ola@example.com')
    expect(parsed.category).toEqual(['stand-up'])
    expect(parsed.social_links).toEqual({
      instagram: 'https://instagram.com/ola',
      youtube: 'https://youtube.com/watch?v=abc123',
    })
    expect(parsed.profile_image_files).toHaveLength(2)
    expect(parsed.primary_profile_image_index).toBe(1)
  })
})

describe('signup error mapping', () => {
  it('maps known validation failures to query codes', () => {
    expect(toSignupErrorCode(new Error('Required fields missing'))).toBe('missing')
    expect(toSignupErrorCode(new Error('Password must be at least 8 characters'))).toBe('invalid_password')
    expect(toSignupErrorCode(new Error('Invalid YouTube URL'))).toBe('invalid_youtube')
    expect(toSignupErrorCode(new Error('Email mismatch for logged in account'))).toBe('account_mismatch')
    expect(toSignupErrorCode(new Error('duplicate key value'))).toBe('email_exists')
  })
})

describe('isYouTubeUrl', () => {
  it('accepts common youtube url formats', () => {
    expect(isYouTubeUrl('https://youtube.com/watch?v=abc')).toBe(true)
    expect(isYouTubeUrl('https://www.youtu.be/abc')).toBe(true)
    expect(isYouTubeUrl('https://m.youtube.com/watch?v=abc')).toBe(true)
    expect(isYouTubeUrl('https://vimeo.com/123')).toBe(false)
  })
})

describe('signup progress stays aligned with validation', () => {
  it('reports complete only when validation would pass', () => {
    const formData = createValidSignupFormData()
    validateArtistSignupForm(formData, { completionMode: false, hasExistingProfileImage: false })

    const values: Record<string, boolean> = {
      full_name: true,
      stage_name: true,
      email: true,
      password: true,
      profile_images: true,
      phone: true,
      language: true,
      gender: true,
    }

    expect(getSignupProgress(values, false).isComplete).toBe(true)
  })
})
