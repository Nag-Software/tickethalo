import { describe, expect, it } from 'vitest'
import {
  BOOKING_SETTING_FIELDS,
  clampBookingSettings,
  DEFAULT_BOOKING_SETTINGS,
  lineupDeadlineDaysFor,
  parseBookingSettings,
} from '@/lib/booking-settings'

/**
 * Grensene er ikke pynt. Tallene her styrer hvor mange e-poster som går ut
 * til ekte komikere, så en rad som er skrevet feil — i skjemaet, i en
 * konsoll eller av en migrasjon — skal ikke kunne nå motoren.
 */

function fullForm(overrides: Record<string, unknown> = {}) {
  return {
    ...Object.fromEntries(BOOKING_SETTING_FIELDS.map((field) => [field.key, DEFAULT_BOOKING_SETTINGS[field.key]])),
    ...overrides,
  }
}

describe('clamping', () => {
  it('gir standardene når raden er tom', () => {
    expect(clampBookingSettings(null)).toEqual(DEFAULT_BOOKING_SETTINGS)
    expect(clampBookingSettings({})).toEqual(DEFAULT_BOOKING_SETTINGS)
  })

  it('klipper en verdi som er skrevet inn utenom skjemaet', () => {
    expect(clampBookingSettings({ offers_per_slot: 5000 }).offers_per_slot).toBe(50)
    expect(clampBookingSettings({ offers_per_slot: -3 }).offers_per_slot).toBe(1)
    expect(clampBookingSettings({ rotation_penalty: -5 }).rotation_penalty).toBe(0)
  })

  it('faller tilbake til standarden når verdien ikke er et tall', () => {
    expect(clampBookingSettings({ offer_response_days: 'sju' }).offer_response_days).toBe(7)
    expect(clampBookingSettings({ rush_days: null }).rush_days).toBe(5)
  })

  it('leser tall som tekst, med komma som desimaltegn', () => {
    expect(clampBookingSettings({ conflict_window_hours: '2,5' }).conflict_window_hours).toBe(2.5)
  })

  it('runder av felt som ikke tåler desimaler', () => {
    expect(clampBookingSettings({ offers_per_day: 2.7 }).offers_per_day).toBe(3)
  })

  it('lar aldri dagsbølgen bli større enn taket', () => {
    const settings = clampBookingSettings({ offers_per_day: 10, offers_per_slot: 4 })
    expect(settings.offers_per_day).toBe(4)
  })
})

describe('skjemaet i superadmin', () => {
  it('tar imot gyldige verdier', () => {
    const { settings, issues } = parseBookingSettings(fullForm({ offers_per_day: 3, offers_per_slot: 12 }))
    expect(issues).toEqual([])
    expect(settings.offers_per_day).toBe(3)
    expect(settings.offers_per_slot).toBe(12)
  })

  it('avviser i stedet for å klippe i stillhet', () => {
    const { issues } = parseBookingSettings(fullForm({ offers_per_slot: 400 }))
    expect(issues).toHaveLength(1)
    expect(issues[0].key).toBe('offers_per_slot')
    expect(issues[0].message).toContain('1 og 50')
  })

  it('sier fra om tomme felt', () => {
    const { issues } = parseBookingSettings(fullForm({ rush_days: '' }))
    expect(issues.map((issue) => issue.key)).toEqual(['rush_days'])
  })

  it('krever hele tall der desimaler ikke gir mening', () => {
    const { issues } = parseBookingSettings(fullForm({ offer_response_days: 7.5 }))
    expect(issues.map((issue) => issue.key)).toEqual(['offer_response_days'])
  })

  it('tillater desimaler på kollisjonsvinduet', () => {
    const { settings, issues } = parseBookingSettings(fullForm({ conflict_window_hours: 2.5 }))
    expect(issues).toEqual([])
    expect(settings.conflict_window_hours).toBe(2.5)
  })

  it('stopper en dagsbølge som er større enn taket', () => {
    const { issues } = parseBookingSettings(fullForm({ offers_per_day: 8, offers_per_slot: 4 }))
    expect(issues.map((issue) => issue.key)).toEqual(['offers_per_day'])
  })

  it('samler opp alle feilene, så de kan rettes i én omgang', () => {
    const { issues } = parseBookingSettings(fullForm({ offers_per_slot: 400, rush_days: 'snart', reminder_hours: -1 }))
    expect(issues.map((issue) => issue.key).sort()).toEqual(['offers_per_slot', 'reminder_hours', 'rush_days'])
  })
})

describe('lineup-fristen per klubb', () => {
  it('bruker plattformens standard når klubben ikke har valgt noe', () => {
    expect(lineupDeadlineDaysFor(null, DEFAULT_BOOKING_SETTINGS)).toBe(14)
    expect(lineupDeadlineDaysFor({ lineup_deadline_days: null }, DEFAULT_BOOKING_SETTINGS)).toBe(14)
  })

  it('bruker klubbens egen når den finnes', () => {
    expect(lineupDeadlineDaysFor({ lineup_deadline_days: 21 }, DEFAULT_BOOKING_SETTINGS)).toBe(21)
  })

  it('holder klubbens verdi innenfor det databasen tillater', () => {
    expect(lineupDeadlineDaysFor({ lineup_deadline_days: 0 }, DEFAULT_BOOKING_SETTINGS)).toBe(1)
    expect(lineupDeadlineDaysFor({ lineup_deadline_days: 900 }, DEFAULT_BOOKING_SETTINGS)).toBe(120)
  })
})
