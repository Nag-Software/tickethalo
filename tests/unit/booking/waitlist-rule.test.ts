import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

const { isWaitlisted } = await import('@/lib/open-spots')

// Tallet på «Submissions»-fanen og fanen selv bruker samme regel. Står en
// søknad på ventelisten, venter den ikke på svar, og skal ikke telles.
describe('isWaitlisted', () => {
  const base = { status: 'pending' as const, isFull: true, showClosed: false, alreadyBooked: false }

  it('puts an open application on a full spot on the waitlist', () => {
    expect(isWaitlisted(base)).toBe(true)
    expect(isWaitlisted({ ...base, status: 'shortlisted' })).toBe(true)
  })

  it('leaves an application on a spot with room as waiting for an answer', () => {
    expect(isWaitlisted({ ...base, isFull: false })).toBe(false)
  })

  it('does not call a handled application waitlisted', () => {
    expect(isWaitlisted({ ...base, status: 'accepted' })).toBe(false)
    expect(isWaitlisted({ ...base, status: 'declined' })).toBe(false)
  })

  it('has no waitlist once the show is over', () => {
    expect(isWaitlisted({ ...base, showClosed: true })).toBe(false)
  })

  it('does not waitlist a comedian who is already in the line-up', () => {
    expect(isWaitlisted({ ...base, alreadyBooked: true })).toBe(false)
  })
})
