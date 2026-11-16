import { describe, expect, it } from 'vitest'
import { gigTypeLabels, gigTypesText, normalizeGigTypes } from '@/lib/gig-types'
import { offerDetails } from '@/lib/booking-engine'
import { bookingConfirmedTemplate, bookingOfferTemplate, offerReminderTemplate, spotAvailableTemplate } from '@/lib/email/templates'

describe('normalizeGigTypes', () => {
  it('reads the form value and the database array the same way', () => {
    expect(normalizeGigTypes('stayer,paid')).toEqual(['paid', 'stayer'])
    expect(normalizeGigTypes(['stayer', 'paid'])).toEqual(['paid', 'stayer'])
  })

  it('drops unknown values, duplicates, blanks and case', () => {
    expect(normalizeGigTypes('Paid, paid,,free, BRINGER ')).toEqual(['paid', 'bringer'])
    expect(normalizeGigTypes(['paid', 7, null])).toEqual(['paid'])
  })

  it('treats a missing value as none set', () => {
    expect(normalizeGigTypes(null)).toEqual([])
    expect(normalizeGigTypes(undefined)).toEqual([])
    expect(normalizeGigTypes('')).toEqual([])
  })

  it('allows all four together', () => {
    expect(normalizeGigTypes('unpaid,stayer,bringer,paid')).toEqual(['paid', 'unpaid', 'bringer', 'stayer'])
  })
})

describe('gig type labels', () => {
  it('writes the labels comedians read', () => {
    expect(gigTypeLabels(['bringer', 'unpaid'])).toEqual(['Unpaid', 'Bringer'])
    expect(gigTypesText(['paid', 'stayer'])).toBe('Paid · Stayer')
  })

  it('says nothing when the club has not set it', () => {
    expect(gigTypesText([])).toBeNull()
    expect(gigTypesText(null)).toBeNull()
  })
})

describe('gig type in the booking offer', () => {
  const show = { start_time: '20:00:00', venue_name: 'No Stress Bar', venue_address: null, currency: 'DKK' }
  const spot = { role_name: 'Stand-up', compensation_type: 'percent' as const, compensation_amount: null, compensation_percent: 10 }

  it('carries the gig type into the offer details', () => {
    expect(offerDetails({ ...show, gig_types: ['paid', 'stayer'] }, spot).gig_type_label).toBe('Paid · Stayer')
    expect(offerDetails(show, spot).gig_type_label).toBeNull()
  })

  it('shows the gig type next to role and fee in every offer email', () => {
    const input = {
      full_name: 'Ida',
      show_title: 'No Stress Comedy Mic',
      show_date: '2026-11-18',
      response_url: 'https://x.test/o',
      role_name: 'Stand-up',
      fee_label: '10% of sales',
      gig_type_label: 'Paid · Stayer',
    }
    for (const template of [bookingOfferTemplate(input), spotAvailableTemplate(input), offerReminderTemplate(input), bookingConfirmedTemplate(input)]) {
      expect(template.html).toContain('Gig type')
      expect(template.html).toContain('Paid · Stayer')
      expect(template.text).toContain('Gig type: Paid · Stayer')
      expect(template.text).toContain('Role: Stand-up')
      expect(template.text).toContain('Fee: 10% of sales')
    }
  })

  it('leaves the line out when the club has not set a gig type', () => {
    const template = bookingOfferTemplate({
      full_name: 'Ida', show_title: 'Mic', show_date: '2026-11-18', response_url: 'https://x.test/o',
    })
    expect(template.html).not.toContain('Gig type')
    expect(template.text).not.toContain('Gig type')
  })
})
