import { describe, expect, it } from 'vitest'
import { startBookingBlockers } from '@/lib/start-booking-blockers'

const spot = { role_name: 'Host', quantity: 1, compensation_type: 'percent', compensation_amount: null, compensation_percent: 15 }

describe('what stops start booking', () => {
  it('lets a complete line-up start', () => {
    expect(startBookingBlockers([spot, { ...spot, role_name: 'Headliner' }], 100)).toEqual([])
  })

  it('names a missing amount, fee model and role', () => {
    expect(startBookingBlockers([
      { ...spot, compensation_type: 'fixed', compensation_percent: null },
      { ...spot, compensation_type: null },
      { ...spot, role_name: ' ' },
    ], 100)).toEqual([
      '1 spot is missing a role name',
      '1 spot is missing a fee model',
      '1 spot is missing an amount or percentage',
    ])
  })

  it('counts percent per seat against the club limit', () => {
    expect(startBookingBlockers([{ ...spot, quantity: 3, compensation_percent: 20 }], 50)).toEqual([
      'Percentage allocation is 60% (max 50%)',
    ])
  })
})
