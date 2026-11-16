import { describe, expect, it } from 'vitest'
import { unstartedSpots } from '@/lib/booking-rules'

const spot = (id: string, extra: Partial<Parameters<typeof unstartedSpots>[0][number]> = {}) => ({
  id,
  quantity: 1,
  submissions_open: false,
  auto_started_at: null as string | null,
  rebook_paused_at: null as string | null,
  ...extra,
})

describe('spots the suggestion can still fill', () => {
  it('leaves out the spot the booker offered by hand, and keeps the rest', () => {
    const spots = [spot('host'), spot('opener'), spot('closer')]
    const taken = new Map([['host', 1]])
    expect(unstartedSpots(spots, taken).map((row) => row.id)).toEqual(['opener', 'closer'])
  })

  it('comes back when the manual offer is withdrawn', () => {
    const spots = [spot('host'), spot('opener')]
    expect(unstartedSpots(spots, new Map()).map((row) => row.id)).toEqual(['host', 'opener'])
  })

  it('leaves out spots auto-booking already runs on', () => {
    const spots = [spot('host', { auto_started_at: '2026-11-16T10:00:00Z' }), spot('opener')]
    expect(unstartedSpots(spots, new Map()).map((row) => row.id)).toEqual(['opener'])
  })

  it('leaves out spots open for submissions and spots waiting on the booker after a removal', () => {
    const spots = [spot('open', { submissions_open: true }), spot('paused', { rebook_paused_at: '2026-11-16T10:00:00Z' }), spot('free')]
    expect(unstartedSpots(spots, new Map()).map((row) => row.id)).toEqual(['free'])
  })

  it('keeps a spot with seats left even if some are taken', () => {
    const spots = [spot('middle', { quantity: 3 })]
    expect(unstartedSpots(spots, new Map([['middle', 2]]))).toHaveLength(1)
    expect(unstartedSpots(spots, new Map([['middle', 3]]))).toHaveLength(0)
  })
})
