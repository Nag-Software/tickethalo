import { describe, expect, it, vi } from 'vitest'
import {
  MAX_ARTIST_PROFILE_IMAGES,
  getPrimaryProfileImageIndex,
  getProfileImageFiles,
  resolveExistingProfileImages,
  resolveProfileImageInput,
  uploadArtistProfileImages,
} from './artist-profile-images'
import { createTestImageFile } from './artist-signup'

function createMockAdmin(storedFiles: Array<{ name: string }> = []) {
  const uploads: Array<{ path: string; file: File }> = []

  return {
    admin: {
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async (path: string, file: File) => {
            uploads.push({ path, file })
            return { error: null }
          }),
          getPublicUrl: vi.fn((path: string) => ({
            data: { publicUrl: `https://cdn.test/${path}` },
          })),
          list: vi.fn(async () => ({ data: storedFiles })),
        })),
      },
    },
    uploads,
  }
}

describe('profile image form parsing', () => {
  it('collects uploaded files and clamps primary index', () => {
    const formData = new FormData()
    formData.append('profile_image_files', createTestImageFile('a.jpg'))
    formData.append('profile_image_files', createTestImageFile('b.jpg'))
    formData.set('primary_profile_image_index', '5')

    const files = getProfileImageFiles(formData)
    expect(files).toHaveLength(2)
    expect(getPrimaryProfileImageIndex(formData, files.length)).toBe(1)
  })

  it('limits uploads to MAX_ARTIST_PROFILE_IMAGES', () => {
    const formData = new FormData()
    for (let index = 0; index < MAX_ARTIST_PROFILE_IMAGES + 2; index += 1) {
      formData.append('profile_image_files', createTestImageFile(`photo-${index}.jpg`))
    }

    expect(getProfileImageFiles(formData)).toHaveLength(MAX_ARTIST_PROFILE_IMAGES)
  })
})

describe('resolveProfileImageInput', () => {
  it('defaults to empty files and primary index zero', () => {
    expect(resolveProfileImageInput({})).toEqual({ files: [], primaryIndex: 0 })
  })
})

describe('uploadArtistProfileImages', () => {
  it('uploads selected primary image first and stores extras separately', async () => {
    const { admin, uploads } = createMockAdmin()
    const files = [
      createTestImageFile('first.jpg'),
      createTestImageFile('second.jpg'),
      createTestImageFile('third.jpg'),
    ]

    const result = await uploadArtistProfileImages(admin as never, 'user-1', files, 2)

    expect(result.profile_image_url).toBe('https://cdn.test/user-1/profile.jpg')
    expect(result.profile_image_urls).toEqual([
      'https://cdn.test/user-1/profile-2.jpg',
      'https://cdn.test/user-1/profile-3.jpg',
    ])
    expect(uploads.map((entry) => entry.path)).toEqual([
      'user-1/profile.jpg',
      'user-1/profile-2.jpg',
      'user-1/profile-3.jpg',
    ])
    expect(uploads[0]?.file.name).toBe('third.jpg')
  })

  it('rejects empty uploads and too many files', async () => {
    const { admin } = createMockAdmin()

    await expect(uploadArtistProfileImages(admin as never, 'user-1', [], 0)).rejects.toThrow(
      'Required fields missing',
    )

    const tooMany = Array.from({ length: MAX_ARTIST_PROFILE_IMAGES + 1 }, (_, index) =>
      createTestImageFile(`photo-${index}.jpg`),
    )

    await expect(uploadArtistProfileImages(admin as never, 'user-1', tooMany, 0)).rejects.toThrow(
      `You can upload at most ${MAX_ARTIST_PROFILE_IMAGES} profile images`,
    )
  })
})

describe('resolveExistingProfileImages', () => {
  it('returns primary and secondary urls sorted from storage', async () => {
    const { admin } = createMockAdmin([
      { name: 'profile-3.jpg' },
      { name: 'profile.jpg' },
      { name: 'profile-2.jpg' },
      { name: 'logo.png' },
    ])

    const result = await resolveExistingProfileImages(admin as never, 'user-1')

    expect(result).toEqual({
      profile_image_url: 'https://cdn.test/user-1/profile.jpg',
      profile_image_urls: [
        'https://cdn.test/user-1/profile-2.jpg',
        'https://cdn.test/user-1/profile-3.jpg',
      ],
    })
  })

  it('returns null when no profile files exist', async () => {
    const { admin } = createMockAdmin([{ name: 'logo.png' }])
    await expect(resolveExistingProfileImages(admin as never, 'user-1')).resolves.toBeNull()
  })
})
