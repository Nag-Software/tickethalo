// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/session', () => ({ getAuthUser: vi.fn(), getSessionProfile: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser, getSessionProfile } from '@/lib/session'
import { setArtistStatusAction } from '@/app/superadmin/(protected)/artists/actions'
import { addClubAdminAction, deleteClubAction, removeClubAdminAction } from '@/app/superadmin/(protected)/clubs/actions'
import { deleteBetaRequestAction, setBetaRequestStatusAction } from '@/app/superadmin/(protected)/beta-requests/actions'

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

function signIn(role: string | null) {
  vi.mocked(getAuthUser).mockResolvedValue(role ? ({ id: 'user-1' } as never) : null)
  vi.mocked(getSessionProfile).mockResolvedValue(role ? ({ id: 'p1', role } as never) : null)
}

// En server action er et endepunkt. Layouten over /superadmin stopper sidene,
// ikke kallene — og disse skriver med service-nøkkelen.
describe('superadmin actions refuse everyone but a superadmin', () => {
  beforeEach(() => {
    vi.mocked(createAdminClient).mockReset()
  })

  const calls: Array<[string, () => Promise<unknown>]> = [
    ['add club admin', () => addClubAdminAction(form({ club_id: 'c1', email: 'x@y.test' }))],
    ['remove club admin', () => removeClubAdminAction(form({ membership_id: 'm1', club_id: 'c1' }))],
    ['delete club', () => deleteClubAction(form({ club_id: 'c1' }))],
    ['set beta status', () => setBetaRequestStatusAction(form({ id: 'b1', status: 'approved' }))],
    ['delete beta request', () => deleteBetaRequestAction(form({ id: 'b1' }))],
  ]

  for (const role of [null, 'admin', 'artist'] as const) {
    for (const [name, call] of calls) {
      it(`${name}: ${role ?? 'signed out'}`, async () => {
        signIn(role)
        await expect(call()).rejects.toThrow()
        expect(createAdminClient).not.toHaveBeenCalled()
      })
    }
  }

  it('set artist status answers with an error and never touches the database', async () => {
    signIn('admin')
    const result = await setArtistStatusAction(form({ artist_id: 'a1', status: 'rejected' }))
    expect(result).toEqual({ error: 'Bare superadmin har tilgang til dette.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})

describe('setArtistStatusAction', () => {
  it('only accepts the statuses moderation is meant to set', async () => {
    signIn('superadmin')
    for (const status of ['pending_review', 'flagged', 'owner', '']) {
      expect(await setArtistStatusAction(form({ artist_id: 'a1', status }))).toEqual({ error: 'Ugyldig status.' })
    }
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('updates the comedian when a superadmin asks', async () => {
    signIn('superadmin')
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({ eq }))
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => ({ update })) } as never)

    expect(await setArtistStatusAction(form({ artist_id: 'a1', status: 'inactive' }))).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith({ status: 'inactive' })
    expect(eq).toHaveBeenCalledWith('id', 'a1')
  })
})
