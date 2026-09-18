// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/email/mailer', () => ({
  sendBookingConfirmedEmail: vi.fn(),
  sendOfferWithdrawnByClubEmail: vi.fn(),
  sendRemovedFromLineupEmail: vi.fn(),
  sendShowCancelledEmail: vi.fn(),
}))

import { cancellationRecipients, isPlayedShow } from '@/lib/lineup-notices'

const artists = [
  { id: 'a1', email: 'ida@example.test', full_name: 'Ida' },
  { id: 'a2', email: 'tom@example.test', full_name: 'Tom' },
  { id: 'a3', email: null, full_name: 'No Email' },
]

describe('cancellationRecipients', () => {
  it('marks the lineup as booked and open offers as not booked', () => {
    expect(cancellationRecipients(['a1'], ['a2'], artists)).toEqual([
      { artistId: 'a1', email: 'ida@example.test', full_name: 'Ida', booked: true },
      { artistId: 'a2', email: 'tom@example.test', full_name: 'Tom', booked: false },
    ])
  })

  it('sends one email to a comedian who is both booked and has an offer out', () => {
    const recipients = cancellationRecipients(['a1', 'a1'], ['a1', 'a2'], artists)
    expect(recipients.map((recipient) => recipient.artistId)).toEqual(['a1', 'a2'])
    expect(recipients[0].booked).toBe(true)
  })

  it('skips comedians without an address or without a row', () => {
    expect(cancellationRecipients(['a3', 'gone'], [], artists)).toEqual([])
  })
})

describe('isPlayedShow', () => {
  it('never notifies about a show that has already been played', () => {
    expect(isPlayedShow('2026-09-17', '2026-09-18')).toBe(true)
    expect(isPlayedShow('2026-09-18', '2026-09-18')).toBe(false)
    expect(isPlayedShow('2026-10-17T00:00:00Z', '2026-09-18')).toBe(false)
  })
})
