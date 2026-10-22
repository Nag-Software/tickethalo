// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryDb } from './memory-db'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { noteLineupChange } from '@/lib/lineup-messages'

const before = {
  date: '2026-11-20',
  start_time: '19:00:00',
  venue_name: 'Crønch',
  venue_address: 'Storgata 1',
  lineup_change_notice: null,
}

function setup(spotStatus: string | null) {
  const tables = {
    shows: [{ id: 'show-1', lineup_change_notice: null as unknown }],
    confirmed_spots: spotStatus ? [{ id: 'spot-1', show_id: 'show-1', status: spotStatus }] : [],
  }
  return { tables, db: memoryDb(tables) as never }
}

describe('noteLineupChange', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('records a change when someone is confirmed', async () => {
    const { tables, db } = setup('confirmed')
    await noteLineupChange(db, 'show-1', before, { ...before, start_time: '20:00' })
    expect(tables.shows[0].lineup_change_notice).toEqual({ start_time: { from: '19:00', to: '20:00' } })
  })

  it('does nothing when no one is confirmed yet', async () => {
    const { tables, db } = setup('cancelled')
    await noteLineupChange(db, 'show-1', before, { ...before, start_time: '20:00' })
    expect(tables.shows[0].lineup_change_notice).toBeNull()
  })

  it('does nothing for a show that has been played', async () => {
    vi.setSystemTime(new Date('2026-12-01T12:00:00Z'))
    const { tables, db } = setup('confirmed')
    await noteLineupChange(db, 'show-1', before, { ...before, venue_name: 'Latter' })
    expect(tables.shows[0].lineup_change_notice).toBeNull()
  })

  it('clears the notice when the change is undone', async () => {
    const { tables, db } = setup('confirmed')
    tables.shows[0].lineup_change_notice = { start_time: { from: '19:00', to: '20:00' } }
    await noteLineupChange(
      db,
      'show-1',
      { ...before, start_time: '20:00:00', lineup_change_notice: { start_time: { from: '19:00', to: '20:00' } } },
      { ...before, start_time: '19:00' },
    )
    expect(tables.shows[0].lineup_change_notice).toBeNull()
  })
})
