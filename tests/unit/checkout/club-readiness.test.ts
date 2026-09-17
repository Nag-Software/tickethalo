// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stripeMock = vi.hoisted(() => ({
  v2: { core: { accounts: { retrieve: vi.fn() } } },
  balanceSettings: { retrieve: vi.fn(), update: vi.fn() },
}))

/**
 * Minimal stand-in for the Supabase query builder: records every query and
 * answers from a queue per `table:operation`. Unqueued selects return no rows
 * and unqueued updates succeed.
 */
const db = vi.hoisted(() => {
  type Query = { table: string; op: 'select' | 'update'; payload?: unknown; calls: Array<[string, ...unknown[]]> }
  type Result = { data: unknown; error: { message: string } | null }

  const queries: Query[] = []
  const queued = new Map<string, Result[]>()

  function from(table: string) {
    const query: Query = { table, op: 'select', calls: [] }
    const chain: Record<string, unknown> = {}

    const resolve = () => {
      queries.push(query)
      const next = queued.get(`${table}:${query.op}`)?.shift()
      return Promise.resolve(next ?? { data: null, error: null })
    }

    for (const name of ['select', 'eq']) {
      chain[name] = (...args: unknown[]) => {
        query.calls.push([name, ...args])
        return chain
      }
    }
    chain.update = (payload: unknown) => {
      query.op = 'update'
      query.payload = payload
      return chain
    }
    chain.maybeSingle = resolve
    chain.single = resolve
    chain.then = (onFulfilled: (value: Result) => unknown, onRejected: (reason: unknown) => unknown) =>
      resolve().then(onFulfilled, onRejected)

    return chain
  }

  return {
    client: { from },
    queries,
    queue(key: string, result: Result) {
      queued.set(key, [...(queued.get(key) ?? []), result])
    },
    updates(table: string) {
      return queries.filter((query) => query.table === table && query.op === 'update')
    },
    reset() {
      queries.length = 0
      queued.clear()
    },
  }
})

vi.mock('@/lib/stripe', () => ({ stripe: stripeMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db.client }))

import {
  assertClubCanSell,
  commissionFor,
  describeClubReadiness,
  ensureClubPayoutScheduleKnown,
  getClubForShow,
  isClubPayoutReady,
  missingReadinessLabels,
  PayoutScheduleSyncError,
  syncAccountStatus,
  type ClubReadiness,
  type ConnectClub,
} from '@/lib/stripe-connect'

const readyClub: ClubReadiness = {
  stripe_account_id: 'acct_123',
  charges_enabled: true,
  payouts_enabled: true,
  payout_schedule_interval: 'manual',
  legal_name: 'Comedy AS',
  org_number: '123456789',
  support_email: 'club@example.com',
}

describe('club checkout readiness', () => {
  it('accepts a fully configured club', () => {
    expect(isClubPayoutReady(readyClub)).toBe(true)
    expect(missingReadinessLabels(readyClub)).toEqual([])
  })

  it('rejects a missing club', () => {
    expect(isClubPayoutReady(null)).toBe(false)
    expect(isClubPayoutReady(undefined)).toBe(false)
    expect(missingReadinessLabels(null)).toEqual(['Showet er ikke koblet til en klubb'])
  })

  it.each([
    ['stripe_account_id', null, 'Stripe account created'],
    ['charges_enabled', false, 'Can accept payments'],
    ['payouts_enabled', false, 'Bank account for payouts'],
    ['payout_schedule_interval', null, 'Payouts held until after the show'],
    ['legal_name', '  ', 'Legal name'],
    ['org_number', '', 'Company registration number'],
  ] as const)('reports missing %s', (key, value, label) => {
    const club = { ...readyClub, [key]: value }
    expect(isClubPayoutReady(club)).toBe(false)
    expect(missingReadinessLabels(club)).toEqual([label])
  })

  it.each(['daily', 'weekly', 'monthly', 'Manual', ''])(
    'is not ready while the payout schedule is %j',
    (interval) => {
      const club = { ...readyClub, payout_schedule_interval: interval }
      expect(isClubPayoutReady(club)).toBe(false)
      expect(missingReadinessLabels(club)).toEqual(['Payouts held until after the show'])
    },
  )

  it('treats an unchecked payout schedule as not ready, even when Stripe is otherwise done', () => {
    const club = { ...readyClub, payout_schedule_interval: null }
    const schedule = describeClubReadiness(club).find((item) => item.key === 'payout_schedule')
    expect(schedule).toEqual({ key: 'payout_schedule', label: 'Payouts held until after the show', done: false })
  })

  it('lists every missing item for a club that has not started', () => {
    const club: ClubReadiness = {
      stripe_account_id: null,
      charges_enabled: false,
      payouts_enabled: false,
      payout_schedule_interval: null,
      legal_name: null,
      org_number: null,
      support_email: null,
    }
    expect(isClubPayoutReady(club)).toBe(false)
    expect(missingReadinessLabels(club)).toEqual([
      'Stripe account created',
      'Can accept payments',
      'Bank account for payouts',
      'Payouts held until after the show',
      'Legal name',
      'Company registration number',
    ])
  })

  it('returns readiness items in onboarding order', () => {
    expect(describeClubReadiness(readyClub).map((item) => item.key)).toEqual([
      'stripe_account', 'charges', 'payouts', 'payout_schedule', 'legal_name', 'org_number',
    ])
  })

  it.each([[10_000, 1000, 1000], [9_999, 1000, 1000], [101, 1000, 10], [0, 1000, 0]] as const)(
    'calculates commission for amount %i at %i bps',
    (amount, platform_fee_bps, expected) => {
      expect(commissionFor(amount, { platform_fee_bps })).toBe(expected)
    },
  )
})

// ─────────────────────────────────────────────────────────────
// Ukjent utbetalingsplan (klubber fra før migrasjon 047)
// ─────────────────────────────────────────────────────────────

/** Unik konto per test: forsøkspausen og pågående synker huskes per konto i modulen. */
let accountSeq = 0
const nextAccount = () => `acct_legacy_${++accountSeq}`

const legacyClub = (overrides: Partial<ConnectClub> = {}): ConnectClub => ({
  id: 'club_1',
  name: 'Comedy Club',
  slug: 'comedy-club',
  currency: 'NOK',
  legal_name: 'Comedy AS',
  org_number: '123456789',
  support_email: 'club@example.com',
  invoice_email: null,
  stripe_account_id: nextAccount(),
  charges_enabled: true,
  payouts_enabled: true,
  onboarding_completed_at: '2026-05-01T10:00:00.000Z',
  platform_fee_bps: 1000,
  commission_vat_bps: 2500,
  payout_hold_days: 3,
  payout_schedule_interval: null,
  ...overrides,
})

const activeAccount = {
  configuration: {
    merchant: {
      capabilities: {
        card_payments: { status: 'active' },
        stripe_balance: { payouts: { status: 'active' } },
      },
    },
  },
  requirements: null,
}

const schedule = (interval: string) => ({ payments: { payouts: { schedule: { interval } } } })

/** En Stripe-feil slik SDK-et former den: `type` og `statusCode` avgjør om den går over. */
function stripeError(type: string, statusCode: number | undefined, message: string) {
  return Object.assign(new Error(message), { type, statusCode })
}

/** Klubbraden `syncAccountStatus` slår opp på konto-ID-en. */
const clubLookup = (id = 'club_1') => db.queue('clubs:select', { data: { id }, error: null })

describe('ensureClubPayoutScheduleKnown', () => {
  beforeEach(() => {
    db.reset()
    vi.resetAllMocks()
    stripeMock.v2.core.accounts.retrieve.mockResolvedValue(activeAccount)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each(['manual', 'daily'])('does not ask Stripe when the schedule is already known (%s)', async (interval) => {
    const club = legacyClub({ payout_schedule_interval: interval })

    await expect(ensureClubPayoutScheduleKnown(club)).resolves.toBe(club)
    expect(stripeMock.balanceSettings.retrieve).not.toHaveBeenCalled()
    expect(db.queries).toEqual([])
  })

  it('does not ask Stripe for a club without an account', async () => {
    const club = legacyClub({ stripe_account_id: null })

    await expect(ensureClubPayoutScheduleKnown(club)).resolves.toBe(club)
    expect(stripeMock.v2.core.accounts.retrieve).not.toHaveBeenCalled()
  })

  it('confirms a legacy club whose Stripe schedule is already manual, and stores it', async () => {
    const club = legacyClub()
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockResolvedValue(schedule('manual'))

    const checked = await ensureClubPayoutScheduleKnown(club)

    expect(checked).toEqual({ ...club, payout_schedule_interval: 'manual' })
    expect(isClubPayoutReady(checked)).toBe(true)
    expect(stripeMock.balanceSettings.update).not.toHaveBeenCalled()
    expect(db.updates('clubs')).toHaveLength(1)
    expect(db.updates('clubs')[0].payload).toMatchObject({ payout_schedule_interval: 'manual' })
  })

  it('switches an automatic schedule to manual on the way', async () => {
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockResolvedValue(schedule('daily'))
    stripeMock.balanceSettings.update.mockResolvedValue(schedule('manual'))

    const checked = await ensureClubPayoutScheduleKnown(legacyClub())

    expect(checked.payout_schedule_interval).toBe('manual')
    expect(stripeMock.balanceSettings.update).toHaveBeenCalledWith(
      { payments: { payouts: { schedule: { interval: 'manual' } } } },
      { stripeAccount: checked.stripe_account_id },
    )
  })

  it('returns a known non-manual schedule when Stripe refuses the change, so the club stays blocked', async () => {
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockResolvedValue(schedule('daily'))
    stripeMock.balanceSettings.update.mockRejectedValue(stripeError('StripePermissionError', 403, 'Not allowed'))

    const checked = await ensureClubPayoutScheduleKnown(legacyClub())

    expect(checked.payout_schedule_interval).toBe('daily')
    expect(isClubPayoutReady(checked)).toBe(false)
  })

  it('stores the known schedule but keeps the club unchanged when Stripe times out on the change', async () => {
    const club = legacyClub()
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockResolvedValue(schedule('daily'))
    stripeMock.balanceSettings.update.mockRejectedValue(stripeError('StripeConnectionError', undefined, 'timeout'))

    await expect(ensureClubPayoutScheduleKnown(club)).resolves.toBe(club)
    expect(db.updates('clubs')[0].payload).toMatchObject({ payout_schedule_interval: 'daily' })
    expect(isClubPayoutReady(club)).toBe(false)
  })

  it('never throws when Stripe is unreachable, and pauses further attempts for that account', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-17T10:00:00.000Z'))
    const club = legacyClub()
    clubLookup()
    stripeMock.v2.core.accounts.retrieve.mockRejectedValueOnce(new Error('Connection timed out'))

    await expect(ensureClubPayoutScheduleKnown(club)).resolves.toBe(club)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Connection timed out'))

    // Neste kjøper venter ikke på samme feilende kall.
    await expect(ensureClubPayoutScheduleKnown(club)).resolves.toBe(club)
    expect(stripeMock.v2.core.accounts.retrieve).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-09-17T10:01:01.000Z'))
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockResolvedValue(schedule('manual'))

    await expect(ensureClubPayoutScheduleKnown(club)).resolves.toMatchObject({ payout_schedule_interval: 'manual' })
    expect(stripeMock.v2.core.accounts.retrieve).toHaveBeenCalledTimes(2)
  })

  it('keeps the club unchanged when the schedule could not be read, without writing a guess', async () => {
    const club = legacyClub()
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockRejectedValue(new Error('Stripe is down'))

    await expect(ensureClubPayoutScheduleKnown(club)).resolves.toBe(club)
    expect(db.updates('clubs')[0].payload).not.toHaveProperty('payout_schedule_interval')
    expect(db.updates('clubs')[0].payload).not.toHaveProperty('payout_schedule_checked_at')
  })

  it('keeps the club unchanged when storing the synced status fails', async () => {
    const club = legacyClub()
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockResolvedValue(schedule('manual'))
    db.queue('clubs:update', { data: null, error: { message: 'connection refused' } })

    await expect(ensureClubPayoutScheduleKnown(club)).resolves.toBe(club)
  })

  it('never hands one club the schedule of an account stored on another club', async () => {
    const club = legacyClub({ id: 'club_1' })
    clubLookup('club_2')
    stripeMock.balanceSettings.retrieve.mockResolvedValue(schedule('manual'))

    await expect(ensureClubPayoutScheduleKnown(club)).resolves.toBe(club)
  })

  it('shares one Stripe check between concurrent buyers of the same club', async () => {
    const club = legacyClub()
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockResolvedValue(schedule('manual'))

    const results = await Promise.all([
      ensureClubPayoutScheduleKnown(club),
      ensureClubPayoutScheduleKnown(club),
      ensureClubPayoutScheduleKnown(club),
    ])

    expect(results.map((result) => result.payout_schedule_interval)).toEqual(['manual', 'manual', 'manual'])
    expect(stripeMock.v2.core.accounts.retrieve).toHaveBeenCalledTimes(1)
    expect(stripeMock.balanceSettings.retrieve).toHaveBeenCalledTimes(1)
  })
})

describe('syncAccountStatus with an unknown payout schedule', () => {
  beforeEach(() => {
    db.reset()
    vi.resetAllMocks()
    stripeMock.v2.core.accounts.retrieve.mockResolvedValue(activeAccount)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('syncs a club row whose schedule is still null', async () => {
    const accountId = nextAccount()
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockResolvedValue(schedule('manual'))

    await expect(syncAccountStatus(accountId)).resolves.toEqual({
      clubId: 'club_1',
      chargesEnabled: true,
      payoutsEnabled: true,
      payoutScheduleInterval: 'manual',
    })
    expect(db.updates('clubs')[0].payload).toMatchObject({
      charges_enabled: true,
      payouts_enabled: true,
      payout_schedule_interval: 'manual',
      payout_schedule_checked_at: expect.any(String),
    })
  })

  it('stores charges and payouts, then throws so the webhook is retried, when Stripe does not answer on the schedule', async () => {
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockRejectedValue(new Error('Stripe is down'))

    await expect(syncAccountStatus(nextAccount())).rejects.toBeInstanceOf(PayoutScheduleSyncError)
    expect(db.updates('clubs')[0].payload).toMatchObject({ charges_enabled: true, payouts_enabled: true })
    expect(db.updates('clubs')[0].payload).not.toHaveProperty('payout_schedule_interval')
  })

  it('also throws when Stripe times out setting manual payouts, after storing the schedule it read', async () => {
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockResolvedValue(schedule('daily'))
    stripeMock.balanceSettings.update.mockRejectedValue(stripeError('StripeAPIError', 500, 'Internal error'))

    await expect(syncAccountStatus(nextAccount())).rejects.toBeInstanceOf(PayoutScheduleSyncError)
    expect(db.updates('clubs')[0].payload).toMatchObject({ payout_schedule_interval: 'daily' })
  })

  it('does not throw on a definitive rejection, so one misconfigured account cannot keep the webhook failing', async () => {
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockResolvedValue(schedule('daily'))
    stripeMock.balanceSettings.update.mockRejectedValue(stripeError('StripeInvalidRequestError', 400, 'Not supported'))

    await expect(syncAccountStatus(nextAccount())).resolves.toMatchObject({ payoutScheduleInterval: 'daily' })
  })

  it('treats a rate limit as temporary even on an invalid-request error type', async () => {
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockRejectedValue(stripeError('StripeInvalidRequestError', 429, 'Too many requests'))

    await expect(syncAccountStatus(nextAccount())).rejects.toBeInstanceOf(PayoutScheduleSyncError)
  })
})

describe('publishing guards for legacy clubs', () => {
  beforeEach(() => {
    db.reset()
    vi.resetAllMocks()
    stripeMock.v2.core.accounts.retrieve.mockResolvedValue(activeAccount)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const queueShowAndClub = (club: ConnectClub) => {
    db.queue('shows:select', { data: { club_id: club.id }, error: null })
    db.queue('clubs:select', { data: club, error: null })
  }

  it('getClubForShow resolves an unknown schedule before callers judge readiness', async () => {
    const club = legacyClub()
    queueShowAndClub(club)
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockResolvedValue(schedule('manual'))

    const loaded = await getClubForShow('show_1')

    expect(loaded).toEqual({ ...club, payout_schedule_interval: 'manual' })
    expect(isClubPayoutReady(loaded)).toBe(true)
  })

  it('assertClubCanSell lets a legacy club publish once Stripe confirms manual payouts', async () => {
    const club = legacyClub()
    queueShowAndClub(club)
    clubLookup()
    stripeMock.balanceSettings.retrieve.mockResolvedValue(schedule('manual'))

    await expect(assertClubCanSell('show_1')).resolves.toMatchObject({ payout_schedule_interval: 'manual' })
  })

  it('assertClubCanSell still blocks when Stripe cannot confirm the schedule', async () => {
    const club = legacyClub()
    queueShowAndClub(club)
    stripeMock.v2.core.accounts.retrieve.mockRejectedValueOnce(new Error('Connection timed out'))
    clubLookup()

    await expect(assertClubCanSell('show_1')).rejects.toThrow('Payouts held until after the show')
  })
})
