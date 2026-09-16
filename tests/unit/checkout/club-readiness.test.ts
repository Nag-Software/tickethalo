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
    expect(missingReadinessLabels(null)).toEqual(['Showet er ikke koblet til en klubb'])
  })

  it.each([
    ['stripe_account_id', null, 'Stripe account created'],
    ['charges_enabled', false, 'Can accept payments'],
    ['payouts_enabled', false, 'Bank account for payouts'],
    ['legal_name', '  ', 'Legal name'],
    ['org_number', '', 'Company registration number'],
  ] as const)('reports missing %s', (key, value, label) => {
    const club = { ...readyClub, [key]: value }
    expect(isClubPayoutReady(club)).toBe(false)
    expect(missingReadinessLabels(club)).toContain(label)
  })

  it('returns readiness items in onboarding order', () => {
    expect(describeClubReadiness(readyClub).map((item) => item.key)).toEqual([
      'stripe_account', 'charges', 'payouts', 'legal_name', 'org_number',
    ])
  })

  it.each([[10_000, 1000, 1000], [9_999, 1000, 1000], [101, 1000, 10], [0, 1000, 0]] as const)(
    'calculates commission for amount %i at %i bps',
    (amount, platform_fee_bps, expected) => {
      expect(commissionFor(amount, { platform_fee_bps })).toBe(expected)
    },
  )
})
