import { describe, expect, it } from 'vitest'
import { artistCanApply } from '@/lib/open-spots'

describe('open spot artist gate', () => {
  it('allows approved artists', () => {
    expect(artistCanApply({ status: 'approved' })).toEqual({ ok: true })
  })

  it('explains that pending profiles are under review', () => {
    expect(artistCanApply({ status: 'pending_review' })).toEqual({
      ok: false,
      reason: 'Your profile is still being reviewed. You can apply as soon as it is approved.',
    })
  })

  it.each(['rejected', 'suspended', 'pending', ''])('rejects unsupported status %j', (status) => {
    expect(artistCanApply({ status })).toEqual({
      ok: false,
      reason: 'Your profile cannot apply for spots right now.',
    })
  })
})
