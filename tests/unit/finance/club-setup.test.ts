import { describe, expect, it } from 'vitest'
import { describeClubSetup } from '@/lib/club-setup'
import { orgNumberFieldLabel, parseOrgNumber } from '@/lib/org-number'

const base = {
  stripe_account_id: null as string | null,
  charges_enabled: false,
  payouts_enabled: false,
  payout_schedule_interval: null as string | null,
  legal_name: 'Comedy Club AS',
  org_number: '999999999',
  support_email: 'club@example.com',
}

describe('describeClubSetup', () => {
  it('starts with the seller when any seller detail is missing', () => {
    expect(describeClubSetup({ ...base, legal_name: null }).step).toBe('seller')
    expect(describeClubSetup({ ...base, org_number: ' ' }).step).toBe('seller')
    expect(describeClubSetup({ ...base, support_email: null }).step).toBe('seller')
  })

  it('moves to Stripe once the seller is known, even without an account', () => {
    const setup = describeClubSetup(base)
    expect(setup.step).toBe('stripe')
    expect(setup.stripe).toEqual({ hasAccount: false, canTakePayments: false, hasBankAccount: false, payoutsHeld: false })
  })

  it('stays on Stripe while Stripe still needs something', () => {
    const setup = describeClubSetup({ ...base, stripe_account_id: 'acct_1', charges_enabled: true, payouts_enabled: false, payout_schedule_interval: 'manual' })
    expect(setup.step).toBe('stripe')
    expect(setup.stripe).toMatchObject({ hasAccount: true, canTakePayments: true, hasBankAccount: false, payoutsHeld: true })
  })

  it('is ready only when Stripe is complete and payouts are held', () => {
    const complete = { ...base, stripe_account_id: 'acct_1', charges_enabled: true, payouts_enabled: true, payout_schedule_interval: 'manual' }
    expect(describeClubSetup(complete).step).toBe('ready')
    expect(describeClubSetup({ ...complete, payout_schedule_interval: 'daily' }).step).toBe('stripe')
    expect(describeClubSetup({ ...complete, payout_schedule_interval: null }).step).toBe('stripe')
  })
})

describe('parseOrgNumber', () => {
  it('accepts the right length per country and strips spaces and hyphens', () => {
    expect(parseOrgNumber('999 999 999', 'NO')).toEqual({ value: '999999999' })
    expect(parseOrgNumber('12345678', 'DK')).toEqual({ value: '12345678' })
    expect(parseOrgNumber('556677-8899', 'SE')).toEqual({ value: '5566778899' })
  })

  it('refuses the wrong length with the country’s own name for the number', () => {
    expect(parseOrgNumber('12345678', 'NO')).toEqual({ error: 'The organisation number must be 9 digits.' })
    expect(parseOrgNumber('999999999', 'DK')).toEqual({ error: 'The cvr number must be 8 digits.' })
    expect(parseOrgNumber('12345678', 'SE')).toEqual({ error: 'The organisationsnummer must be 10 digits.' })
  })

  it('treats an empty field as not filled in, and an unknown country as Norway', () => {
    expect(parseOrgNumber('', 'DK')).toEqual({ value: null })
    expect(parseOrgNumber(null, undefined)).toEqual({ value: null })
    expect(parseOrgNumber('999999999', 'XX')).toEqual({ value: '999999999' })
  })

  it('labels the field per country', () => {
    expect(orgNumberFieldLabel('DK')).toBe('CVR number')
    expect(orgNumberFieldLabel('SE')).toBe('Organisationsnummer')
    expect(orgNumberFieldLabel('NO')).toBe('Organisation number')
  })
})
