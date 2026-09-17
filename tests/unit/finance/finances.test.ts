import { describe, expect, it } from 'vitest'
import { clubNetAfterRefunds } from '@/lib/finances'

describe('clubNetAfterRefunds', () => {
  it('is the club share when nothing is refunded', () => {
    expect(clubNetAfterRefunds({ club_net_amount: 45_000, refunded_amount: 0, application_fee_refunded_amount: 0 })).toBe(45_000)
    expect(clubNetAfterRefunds({ club_net_amount: 45_000 })).toBe(45_000)
  })

  it('subtracts a partial refund made in the Stripe dashboard without returning commission', () => {
    // 500 kr, 50 kr provisjon, 200 kr refundert uten tilbakeført provisjon.
    expect(clubNetAfterRefunds({ club_net_amount: 45_000, refunded_amount: 20_000, application_fee_refunded_amount: 0 })).toBe(
      25_000,
    )
  })

  it('adds back commission Tickethalo returned with the refund', () => {
    expect(
      clubNetAfterRefunds({ club_net_amount: 45_000, refunded_amount: 20_000, application_fee_refunded_amount: 2_000 }),
    ).toBe(27_000)
    expect(
      clubNetAfterRefunds({ club_net_amount: 45_000, refunded_amount: 50_000, application_fee_refunded_amount: 5_000 }),
    ).toBe(0)
  })

  it('never goes below zero and treats missing amounts as zero', () => {
    expect(clubNetAfterRefunds({ club_net_amount: 45_000, refunded_amount: 50_000, application_fee_refunded_amount: 0 })).toBe(0)
    expect(clubNetAfterRefunds({ club_net_amount: null, refunded_amount: null, application_fee_refunded_amount: null })).toBe(0)
  })
})
