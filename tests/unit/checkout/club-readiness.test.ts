import { describe, expect, it } from 'vitest'
import {
  commissionFor,
  describeClubReadiness,
  isClubPayoutReady,
  missingReadinessLabels,
  type ClubReadiness,
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
