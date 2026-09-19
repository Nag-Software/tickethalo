import { describe, expect, it } from 'vitest'
import { artistPhotoFileName, attachmentDisposition, isAllowedPhotoUrl, photoExtension } from '@/lib/artist-photo'

const SUPABASE = 'https://abc.supabase.co'

describe('artistPhotoFileName', () => {
  it('names the file after the profile, Norwegian letters included', () => {
    expect(artistPhotoFileName('Ida Example', 'jpg')).toBe('Ida Example.jpg')
    expect(artistPhotoFileName('Bjørn Ås', 'png')).toBe('Bjørn Ås.png')
  })

  it('drops what a file system cannot take, and never returns an empty name', () => {
    expect(artistPhotoFileName('  AC/DC: "Live"  ', 'jpg')).toBe('AC DC Live.jpg')
    expect(artistPhotoFileName('../..', 'jpg')).toBe('comedian.jpg')
  })
})

describe('photoExtension', () => {
  it('trusts the content type before the URL', () => {
    expect(photoExtension('image/png', 'https://x.test/a.jpg')).toBe('png')
    expect(photoExtension('image/jpeg; charset=binary', 'https://x.test/a')).toBe('jpg')
  })

  it('falls back to the URL, then to jpg', () => {
    expect(photoExtension(null, 'https://x.test/photos/a.WEBP?v=2')).toBe('webp')
    expect(photoExtension('application/octet-stream', 'https://x.test/a.jpeg')).toBe('jpg')
    expect(photoExtension(null, 'https://x.test/a')).toBe('jpg')
  })
})

describe('attachmentDisposition', () => {
  it('carries the real name and an ASCII fallback', () => {
    expect(attachmentDisposition('Bjørn Ås.png')).toBe(
      `attachment; filename="Bjrn As.png"; filename*=UTF-8''Bj%C3%B8rn%20%C3%85s.png`,
    )
  })
})

// URL-en står i en rad komikeren selv fyller ut. Serveren henter bare fra
// vertene bildene faktisk ligger på.
describe('isAllowedPhotoUrl', () => {
  it('allows the storage host and nothing else', () => {
    expect(isAllowedPhotoUrl('https://abc.supabase.co/storage/v1/object/public/p/a.jpg', SUPABASE)).toBe(true)
    expect(isAllowedPhotoUrl('https://upload.wikimedia.org/wikipedia/commons/a.jpg', SUPABASE)).toBe(true)
    expect(isAllowedPhotoUrl('http://abc.supabase.co/a.jpg', SUPABASE)).toBe(false)
    expect(isAllowedPhotoUrl('https://169.254.169.254/latest/meta-data', SUPABASE)).toBe(false)
    expect(isAllowedPhotoUrl('https://evil.test/a.jpg', SUPABASE)).toBe(false)
    expect(isAllowedPhotoUrl('not a url', SUPABASE)).toBe(false)
  })
})
