import { describe, it, expect } from 'vitest'
import { formatBookingHonorar } from './booking-offer-format'

// Money is stored in øre across the booking pipeline (see optionalMoneyToMinor on
// the admin write side and the `fee_amount … stored in øre/cents` mailer comment).
// A 1 500 kr fee is persisted as 150000. Regression guard for the bug where the
// honorar rendered 100× too high (150 000 NOK) in offer/confirmation emails.
const KR_1500_IN_ORE = 150_000

function digitsOf(value: string) {
  return value.replace(/\D/g, '')
}

describe('formatBookingHonorar', () => {
  it('renders a fee_amount (øre) as kroner, not 100× too high', () => {
    const out = formatBookingHonorar({ fee_amount: KR_1500_IN_ORE, currency: 'NOK' })
    expect(digitsOf(out)).toBe('1500')
  })

  it('renders a fixed compensation_amount (øre) as kroner, not 100× too high', () => {
    const out = formatBookingHonorar({
      compensation_type: 'fixed',
      compensation_amount: KR_1500_IN_ORE,
      currency: 'NOK',
    })
    expect(digitsOf(out)).toBe('1500')
  })

  it('prefers fee_amount over compensation_amount when both are present', () => {
    const out = formatBookingHonorar({
      fee_amount: KR_1500_IN_ORE,
      compensation_type: 'fixed',
      compensation_amount: 999_999,
      currency: 'NOK',
    })
    expect(digitsOf(out)).toBe('1500')
  })

  it('renders percentage compensation as a share of ticket revenue', () => {
    const out = formatBookingHonorar({ compensation_type: 'percent', compensation_percent: 40 })
    expect(out).toBe('40% av billettinntekter')
  })

  it('falls back to «Ikke oppgitt» when nothing is set', () => {
    expect(formatBookingHonorar({})).toBe('Ikke oppgitt')
  })
})
