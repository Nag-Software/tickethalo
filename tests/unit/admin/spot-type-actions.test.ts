import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryDb, type FakeQuery } from '../booking/fake-query-db'
import type { ClubSpotType } from '@/lib/spot-types'

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  types: [] as ClubSpotType[],
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db }))
vi.mock('@/lib/club-auth', () => ({ getDefaultClubIdForAdmin: vi.fn(async () => 'club-1') }))
vi.mock('@/lib/spot-types-data', () => ({ getClubSpotTypes: vi.fn(async () => mocks.types) }))

const { addSpotTypeAction, moveSpotTypeAction, updateSpotTypeAction } = await import(
  '@/app/admin-app/(protected)/my-club/spot-type-actions'
)

const type = (extra: Partial<ClubSpotType>): ClubSpotType => ({
  id: 'x',
  club_id: 'club-1',
  standard_key: null,
  name: 'X',
  position: 1,
  active: true,
  is_unpaid: false,
  default_compensation_percent: null,
  ...extra,
})

function setup() {
  const { db, queries } = fakeQueryDb({ club_spot_types: () => ({}) })
  mocks.db = db
  return queries as FakeQuery[]
}

describe('spot type actions', () => {
  beforeEach(() => {
    mocks.types = [
      type({ id: 'host', standard_key: 'konferansier', name: 'Host / MC', position: 1 }),
      type({ id: 'open', standard_key: 'open mic', name: 'Open Spot', position: 2, is_unpaid: true }),
      type({ id: 'guest', name: 'Guest', position: 3 }),
    ]
  })

  it('adds a custom type at the end of the list', async () => {
    const queries = setup()
    await expect(addSpotTypeAction({ name: '  Improv  spot ', is_unpaid: true, default_compensation_percent: '5' })).resolves.toEqual({ ok: true })
    const insert = queries.find((query) => query.write === 'insert')
    expect(insert?.values).toMatchObject({ club_id: 'club-1', standard_key: null, name: 'Improv spot', position: 4, is_unpaid: true, default_compensation_percent: 5 })
  })

  it('refuses a name that is a standard type, a duplicate, or empty', async () => {
    setup()
    expect(await addSpotTypeAction({ name: 'Open Mic' })).toMatchObject({ ok: false })
    expect(await addSpotTypeAction({ name: 'Headliner' })).toMatchObject({ ok: false })
    expect(await addSpotTypeAction({ name: 'guest' })).toMatchObject({ ok: false })
    expect(await addSpotTypeAction({ name: '   ' })).toMatchObject({ ok: false })
  })

  it('refuses a fee outside 0–100', async () => {
    setup()
    expect(await addSpotTypeAction({ name: 'Improv', default_compensation_percent: '120' })).toMatchObject({ ok: false })
    expect(await updateSpotTypeAction({ id: 'guest', default_compensation_percent: '-1' })).toMatchObject({ ok: false })
  })

  it('only changes a type that belongs to the club', async () => {
    const queries = setup()
    expect(await updateSpotTypeAction({ id: 'someone-elses', active: false })).toMatchObject({ ok: false })
    expect(queries.some((query) => query.write)).toBe(false)
  })

  it('switches a type off without touching its name', async () => {
    const queries = setup()
    await updateSpotTypeAction({ id: 'host', active: false })
    const update = queries.find((query) => query.write === 'update')
    expect(update?.values).toEqual({ active: false })
    expect(update?.filters).toMatchObject({ id: 'host', club_id: 'club-1' })
  })

  it('moves a type and rewrites the order 1..n', async () => {
    const queries = setup()
    await moveSpotTypeAction({ id: 'guest', direction: 'up' })
    const updates = queries.filter((query) => query.write === 'update')
    expect(updates.map((query) => [query.filters.id, (query.values as { position: number }).position])).toEqual([
      ['host', 1],
      ['guest', 2],
      ['open', 3],
    ])
  })
})
