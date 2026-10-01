import { describe, expect, it } from 'vitest'
import { socialHandle, socialLinksFromForm, socialProfileUrl, websiteUrl } from '@/lib/social-links'

describe('socialProfileUrl', () => {
  it.each([
    '@tomsoyler',
    'tomsoyler',
    ' @tomsoyler ',
    'instagram.com/tomsoyler',
    'https://instagram.com/tomsoyler/?hl=en',
    'https://www.instagram.com/tomsoyler',
  ])('turns %j into the Instagram profile', (input) => {
    expect(socialProfileUrl('instagram', input)).toBe('https://www.instagram.com/tomsoyler')
  })

  it('builds TikTok profiles under /@', () => {
    expect(socialProfileUrl('tiktok', '@tom.soyler')).toBe('https://www.tiktok.com/@tom.soyler')
    expect(socialProfileUrl('tiktok', 'https://www.tiktok.com/@tom.soyler?lang=en')).toBe('https://www.tiktok.com/@tom.soyler')
  })

  it('keeps network links that are not a profile as they are', () => {
    expect(socialProfileUrl('tiktok', 'https://vm.tiktok.com/ZMabc123/')).toBe('https://vm.tiktok.com/ZMabc123/')
    expect(socialProfileUrl('facebook', 'https://www.facebook.com/profile.php?id=100')).toBe('https://www.facebook.com/profile.php?id=100')
  })

  it('keeps a pasted link to another site', () => {
    expect(socialProfileUrl('instagram', 'https://linktr.ee/tomsoyler')).toBe('https://linktr.ee/tomsoyler')
  })

  it('drops empty, spaced and non-http input', () => {
    expect(socialProfileUrl('instagram', '')).toBeUndefined()
    expect(socialProfileUrl('instagram', 'tom soyler')).toBeUndefined()
    expect(socialProfileUrl('instagram', 'javascript:alert(1)')).toBeUndefined()
  })
})

describe('socialHandle', () => {
  it('shows the handle for a stored profile link', () => {
    expect(socialHandle('instagram', 'https://instagram.com/tomsoyler/')).toBe('tomsoyler')
    expect(socialHandle('tiktok', 'https://www.tiktok.com/@tomsoyler')).toBe('tomsoyler')
  })

  it('shows the link when there is no handle in it', () => {
    expect(socialHandle('facebook', 'https://www.facebook.com/profile.php?id=100')).toBe('https://www.facebook.com/profile.php?id=100')
    expect(socialHandle('instagram', undefined)).toBe('')
  })
})

describe('websiteUrl', () => {
  it('adds https:// to a bare domain', () => {
    expect(websiteUrl('tomsoyler.no')).toBe('https://tomsoyler.no/')
    expect(websiteUrl('http://tomsoyler.no/shows')).toBe('http://tomsoyler.no/shows')
  })

  it('drops text that is not a site', () => {
    expect(websiteUrl('tomsoyler')).toBeUndefined()
    expect(websiteUrl('javascript:alert(1)')).toBeUndefined()
  })
})

describe('socialLinksFromForm', () => {
  it('stores full links and leaves out empty fields', () => {
    const form = new FormData()
    form.set('instagram', '@tomsoyler')
    form.set('tiktok', '')
    form.set('website', 'tomsoyler.no')
    expect(socialLinksFromForm(form)).toEqual({
      instagram: 'https://www.instagram.com/tomsoyler',
      website: 'https://tomsoyler.no/',
    })
  })

  it('is null when nothing is filled in', () => {
    expect(socialLinksFromForm(new FormData())).toBeNull()
  })
})
