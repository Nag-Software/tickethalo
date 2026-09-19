// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/email/mailer', () => ({ sendLineupFullEmail: vi.fn() }))
vi.mock('@/lib/stripe-connect', () => ({
  getClubForShow: vi.fn(async () => ({ id: 'club-1' })),
  isClubPayoutReady: vi.fn(() => true),
  missingReadinessLabels: vi.fn(() => []),
}))
vi.mock('@/lib/poster/generate', () => ({ generateShowPoster: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendLineupFullEmail } from '@/lib/email/mailer'
import { automateFullbookedShow } from '@/lib/actions/booking'

/**
 * En liten Supabase i minnet: nok til å følge ett show gjennom funksjonen.
 * Hver kjede samler filtrene sine og svarer når den avventes.
 */
type Query = {
  table: string
  op: 'select' | 'update'
  values?: Record<string, unknown>
  filters: Array<[string, string, unknown]>
  head: boolean
}

function fakeDb(state: { show: Record<string, unknown>; filledSpots: number }) {
  const updates: Array<Record<string, unknown>> = []

  const matchesShow = (filters: Query['filters']) => filters.every(([kind, column, value]) => {
    if (column === 'id') return true
    const current = state.show[column]
    if (kind === 'eq') return current === value
    if (kind === 'neq') return current !== value
    if (kind === 'in') return (value as unknown[]).includes(current)
    if (kind === 'is') return current === value
    if (kind === 'not') return current !== value
    return true
  })

  const answer = (query: Query) => {
    if (query.table === 'shows' && query.op === 'update') {
      if (!matchesShow(query.filters)) return { data: [], error: null }
      Object.assign(state.show, query.values)
      updates.push(query.values ?? {})
      return { data: [{ id: 'show-1' }], error: null }
    }
    if (query.table === 'shows') return { data: state.show, error: null }
    if (query.table === 'show_requirements') return { data: [{ id: 'req-1', role_name: 'Headliner', quantity: 1 }] }
    if (query.table === 'confirmed_spots') {
      return query.head
        ? { count: state.filledSpots }
        : { data: [{ artist_id: 'a1', show_requirement_id: 'req-1' }] }
    }
    if (query.table === 'club_memberships') return { data: [{ profile_id: 'p1' }, { profile_id: 'p2' }] }
    if (query.table === 'profiles') {
      return { data: [{ email: 'kari@club.test', full_name: 'Kari' }, { email: 'ola@club.test', full_name: null }] }
    }
    if (query.table === 'artists') return { data: [{ id: 'a1', full_name: 'Ida Example', stage_name: 'Ida' }] }
    return { data: null }
  }

  const from = (table: string) => {
    const query: Query = { table, op: 'select', filters: [], head: false }
    const chain: Record<string, unknown> = {
      select: (_columns?: string, options?: { head?: boolean }) => {
        if (options?.head) query.head = true
        return chain
      },
      update: (values: Record<string, unknown>) => {
        query.op = 'update'
        query.values = values
        return chain
      },
      single: () => chain,
      maybeSingle: () => chain,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer(query)).then(resolve),
    }
    for (const kind of ['eq', 'neq', 'in', 'is']) {
      chain[kind] = (column: string, value: unknown) => {
        query.filters.push([kind, column, value])
        return chain
      }
    }
    chain.not = (column: string, _operator: string, value: unknown) => {
      query.filters.push(['not', column, value])
      return chain
    }
    return chain
  }

  return { client: { from }, updates }
}

const baseShow = () => ({
  title: 'Backstage Stand Up',
  date: '2026-10-17',
  status: 'booking',
  club_id: 'club-1',
  poster_url: null,
  description: null,
  ticket_price: null,
  published_at: null,
  lineup_full_notified_at: null as string | null,
})

// Showet publiserte seg selv i det lineupen ble full — uten plakat, tekst og
// billettsalg. Nå varsles klubben, og publiseringen er klubbens egen.
describe('automateFullbookedShow', () => {
  beforeEach(() => {
    vi.mocked(sendLineupFullEmail).mockReset().mockResolvedValue({ success: true })
  })

  it('never publishes: a full lineup becomes fullbooked and the club is asked', async () => {
    const state = { show: baseShow(), filledSpots: 1 }
    const db = fakeDb(state)
    vi.mocked(createAdminClient).mockReturnValue(db.client as never)

    const result = await automateFullbookedShow('show-1')

    expect(result).toMatchObject({ fullbooked: true, published: false, notifiedNow: true })
    expect(state.show.status).toBe('fullbooked')
    expect(state.show.published_at).toBeNull()
    expect(db.updates.some((values) => values.status === 'published')).toBe(false)

    expect(sendLineupFullEmail).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sendLineupFullEmail).mock.calls[0][0]).toMatchObject({
      email: 'kari@club.test',
      lineup: ['Ida'],
      missing: ['a poster', 'a description', 'a ticket price'],
    })
  })

  it('sends the notice once, however often the engine runs', async () => {
    const state = { show: baseShow(), filledSpots: 1 }
    vi.mocked(createAdminClient).mockReturnValue(fakeDb(state).client as never)

    await automateFullbookedShow('show-1')
    const again = await automateFullbookedShow('show-1')

    expect(again).toMatchObject({ fullbooked: true, notifiedNow: false })
    expect(sendLineupFullEmail).toHaveBeenCalledTimes(2)
  })

  it('tries again next run when no email went out', async () => {
    vi.mocked(sendLineupFullEmail).mockResolvedValue({ success: false, error: 'rate_limit_exceeded' })
    const state = { show: baseShow(), filledSpots: 1 }
    vi.mocked(createAdminClient).mockReturnValue(fakeDb(state).client as never)

    const result = await automateFullbookedShow('show-1')

    expect(result).toMatchObject({ notifiedNow: false })
    expect(state.show.lineup_full_notified_at).toBeNull()
  })

  it('reopens the show when a comedian drops out before it is published', async () => {
    const state = { show: { ...baseShow(), status: 'fullbooked', lineup_full_notified_at: '2026-09-01T06:00:00Z' }, filledSpots: 0 }
    vi.mocked(createAdminClient).mockReturnValue(fakeDb(state).client as never)

    const result = await automateFullbookedShow('show-1')

    expect(result).toMatchObject({ fullbooked: false, reason: 'requirements_not_filled' })
    expect(state.show.status).toBe('booking')
    expect(state.show.lineup_full_notified_at).toBeNull()
    expect(sendLineupFullEmail).not.toHaveBeenCalled()
  })

  it('leaves a published show alone', async () => {
    const state = { show: { ...baseShow(), status: 'published', published_at: '2026-09-01T06:00:00Z' }, filledSpots: 1 }
    const db = fakeDb(state)
    vi.mocked(createAdminClient).mockReturnValue(db.client as never)

    const result = await automateFullbookedShow('show-1')

    expect(result).toMatchObject({ fullbooked: true, published: true, notifiedNow: false })
    expect(db.updates).toEqual([])
    expect(sendLineupFullEmail).not.toHaveBeenCalled()
  })
})
