import { describe, expect, it } from 'vitest'
import { clubNetAfterRefunds, clubNetExVatAfterRefunds, ticketVatAfterRefunds } from '@/lib/finances'

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

describe('ticketVatAfterRefunds', () => {
  it('is zero for orders without VAT, including orders from before the column existed', () => {
    expect(ticketVatAfterRefunds({ club_net_amount: 45_000, gross_amount: 50_000 })).toBe(0)
    expect(ticketVatAfterRefunds({ club_net_amount: 45_000, gross_amount: 50_000, ticket_vat_amount: null })).toBe(0)
    expect(ticketVatAfterRefunds({ club_net_amount: 45_000, gross_amount: 50_000, ticket_vat_amount: 0 })).toBe(0)
  })

  it('keeps the whole VAT when nothing is refunded', () => {
    // 200 DKK incl. 25 % VAT: 40 DKK VAT.
    expect(ticketVatAfterRefunds({ club_net_amount: 19_000, gross_amount: 20_000, ticket_vat_amount: 4_000 })).toBe(4_000)
  })

  it('returns the same share of the VAT as was refunded', () => {
    // Half the order refunded → half the VAT went back to the customer.
    expect(
      ticketVatAfterRefunds({ club_net_amount: 19_000, gross_amount: 20_000, ticket_vat_amount: 4_000, refunded_amount: 10_000 }),
    ).toBe(2_000)
    expect(
      ticketVatAfterRefunds({ club_net_amount: 19_000, gross_amount: 20_000, ticket_vat_amount: 4_000, refunded_amount: 20_000 }),
    ).toBe(0)
  })
})

describe('clubNetExVatAfterRefunds', () => {
  it('equals the club share for a Norwegian club', () => {
    const order = { club_net_amount: 45_000, gross_amount: 50_000, refunded_amount: 0, application_fee_refunded_amount: 0 }
    expect(clubNetExVatAfterRefunds(order)).toBe(clubNetAfterRefunds(order))
  })

  it('takes the VAT out of the fee basis for a Danish club', () => {
    // 200 DKK ticket, 5 % commission on the gross: 190 to the club, of which
    // 40 is VAT → 150 to share with the lineup.
    expect(clubNetExVatAfterRefunds({ club_net_amount: 19_000, gross_amount: 20_000, ticket_vat_amount: 4_000 })).toBe(15_000)
  })

  it('removes only the remaining VAT after a partial refund', () => {
    // Half refunded without commission returned: 190 − 100 = 90 kept, 20 VAT left → 70.
    expect(
      clubNetExVatAfterRefunds({
        club_net_amount: 19_000,
        gross_amount: 20_000,
        ticket_vat_amount: 4_000,
        refunded_amount: 10_000,
        application_fee_refunded_amount: 0,
      }),
    ).toBe(7_000)
  })

  it('never goes below zero', () => {
    expect(
      clubNetExVatAfterRefunds({ club_net_amount: 1_000, gross_amount: 20_000, ticket_vat_amount: 4_000, refunded_amount: 0 }),
    ).toBe(0)
  })
})
