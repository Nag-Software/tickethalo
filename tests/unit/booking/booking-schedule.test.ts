import { describe, expect, it } from 'vitest'
import {
  dateMinusDays,
  daysBetween,
  isRushMode,
  lineupDeadlineAt,
  offerExpiresAt,
  offerTarget,
  osloDateString,
  shouldRemind,
} from '@/lib/booking-schedule'
import { DEFAULT_BOOKING_SETTINGS } from '@/lib/booking-settings'

const settings = DEFAULT_BOOKING_SETTINGS

/** Showet ligger 13. mars 2026. Lineup-fristen er da 27. februar. */
const SHOW_DATE = '2026-03-13'
const deadline = lineupDeadlineAt(SHOW_DATE, 14)

function at(iso: string) {
  return new Date(iso)
}

function rush(now: string) {
  return isRushMode({ now: at(now), showDate: SHOW_DATE, deadlineDays: 14, settings })
}

describe('dager', () => {
  it('teller hele dager mellom to datoer', () => {
    expect(daysBetween('2026-03-01', '2026-03-13')).toBe(12)
    expect(daysBetween('2026-03-13', '2026-03-01')).toBe(-12)
    expect(daysBetween('2026-03-13', '2026-03-13')).toBe(0)
  })

  it('trekker fra dager uten å bomme over et månedsskifte', () => {
    expect(dateMinusDays('2026-03-13', 14)).toBe('2026-02-27')
    expect(dateMinusDays('2026-01-05', 10)).toBe('2025-12-26')
  })

  it('leser datoen i norsk tid, ikke i UTC', () => {
    // 23:30 UTC 12. mars er allerede 13. mars i Oslo. En bølge som telte
    // dager i UTC ville hoppet over en dag hver gang klokken stilles.
    expect(osloDateString(at('2026-03-12T23:30:00Z'))).toBe('2026-03-13')
    expect(osloDateString(at('2026-03-13T00:30:00Z'))).toBe('2026-03-13')
  })
})

describe('bølgen', () => {
  const started = '2026-02-01T07:00:00Z'

  it('sender to per sete den første dagen', () => {
    expect(offerTarget({ autoStartedAt: started, now: at('2026-02-01T09:00:00Z'), settings, rush: false })).toBe(2)
  })

  it('trapper opp med to hver morgen', () => {
    expect(offerTarget({ autoStartedAt: started, now: at('2026-02-02T06:00:00Z'), settings, rush: false })).toBe(4)
    expect(offerTarget({ autoStartedAt: started, now: at('2026-02-03T06:00:00Z'), settings, rush: false })).toBe(6)
  })

  it('stopper på taket', () => {
    expect(offerTarget({ autoStartedAt: started, now: at('2026-02-20T06:00:00Z'), settings, rush: false })).toBe(10)
  })

  it('sender alt med en gang i hastemodus', () => {
    expect(offerTarget({ autoStartedAt: started, now: at('2026-02-01T09:00:00Z'), settings, rush: true })).toBe(10)
  })

  it('rører ikke en plass automatikken ikke er startet på', () => {
    expect(offerTarget({ autoStartedAt: null, now: at('2026-02-01T09:00:00Z'), settings, rush: false })).toBe(0)
    expect(offerTarget({ autoStartedAt: null, now: at('2026-02-01T09:00:00Z'), settings, rush: true })).toBe(0)
  })
})

describe('lineup-fristen', () => {
  it('ligger så mange dager før showet som klubben har sagt', () => {
    expect(lineupDeadlineAt(SHOW_DATE, 14).toISOString().slice(0, 10)).toBe('2026-02-27')
    expect(lineupDeadlineAt(SHOW_DATE, 21).toISOString().slice(0, 10)).toBe('2026-02-20')
  })

  it('slutter ved midnatt i Oslo, ikke i UTC', () => {
    // 22:59:59Z er 23:59:59 i Oslo om vinteren. Ble fristen regnet i UTC,
    // lå den 00:59 dagen etter, og hele fristen skled en dag ut.
    expect(lineupDeadlineAt(SHOW_DATE, 14).toISOString()).toBe('2026-02-27T22:59:59.000Z')
    // Sommertid: to timer foran.
    expect(lineupDeadlineAt('2026-07-31', 14).toISOString()).toBe('2026-07-17T21:59:59.000Z')
  })

  it('slår på hastemodus fem dager før fristen', () => {
    expect(rush('2026-02-21T09:00:00Z')).toBe(false)
    expect(rush('2026-02-23T09:00:00Z')).toBe(true)
  })

  // Fristen er 27. februar, så dag fem er den 22. Trakk vi fem døgn fra selve
  // fristen — midnatt — begynte hastemodus først 22:59 den dagen, og
  // morgenkjøringen gikk fortsatt i normal takt. Én av fem dager tapt.
  it('rekker morgenkjøringen på dag fem', () => {
    expect(rush('2026-02-22T06:00:00Z')).toBe(true)
    expect(rush('2026-02-21T23:30:00Z')).toBe(true) // = 22. februar i Oslo
  })

  it('blir stående i hastemodus etter fristen', () => {
    expect(rush('2026-03-05T09:00:00Z')).toBe(true)
  })
})

describe('svarfristen', () => {
  const expiry = (now: string) =>
    offerExpiresAt({ now: at(now), showDate: SHOW_DATE, lineupDeadline: deadline, settings })

  it('gir sju dager i god tid før fristen', () => {
    expect(expiry('2026-02-01T09:00:00Z')).toBe('2026-02-08T09:00:00.000Z')
  })

  it('går aldri forbi lineup-fristen', () => {
    // Fem dager igjen til fristen: tilbudet står ut fristen, ikke sju dager.
    expect(expiry('2026-02-24T09:00:00Z')).toBe('2026-02-27T22:59:59.000Z')
  })

  it('gir 48 timer når fristen er passert, men aldri forbi dagen før showet', () => {
    expect(expiry('2026-03-02T09:00:00Z')).toBe('2026-03-04T09:00:00.000Z')
    // Siste frist er midnatt i Oslo dagen før showet. Regnet i UTC lå den
    // 00:59 på selve showdagen, og et tilbud kunne godtas samme morgen —
    // nøyaktig det showdag-sperren finnes for å hindre.
    expect(expiry('2026-03-11T09:00:00Z')).toBe('2026-03-12T22:59:59.000Z')
  })

  it('bruker den korte fristen når lineup-fristen er så nær at sju dager ville blitt to timer', () => {
    // 22:00 kvelden før fristen. Fristen ville gitt to timers svartid; da er
    // 48 timer bedre for alle.
    expect(expiry('2026-02-27T21:00:00Z')).toBe('2026-03-01T21:00:00.000Z')
  })

  it('sender ingenting på showdagen', () => {
    expect(expiry('2026-03-13T08:00:00Z')).toBeNull()
    expect(expiry('2026-03-14T08:00:00Z')).toBeNull()
  })

  it('sender ingenting når det ikke er noen dato', () => {
    expect(offerExpiresAt({ now: at('2026-02-01T09:00:00Z'), showDate: '', lineupDeadline: deadline, settings })).toBeNull()
  })
})

describe('påminnelsen', () => {
  const offer = (overrides: Partial<Parameters<typeof shouldRemind>[0]['offer']> = {}) => ({
    status: 'sent',
    sent_at: '2026-02-01T09:00:00Z',
    expires_at: '2026-02-08T09:00:00Z',
    reminded_at: null,
    ...overrides,
  })

  it('går ut når det er under to døgn igjen', () => {
    expect(shouldRemind({ offer: offer(), now: at('2026-02-06T10:00:00Z'), settings })).toBe(true)
  })

  it('går ikke ut for tidlig', () => {
    expect(shouldRemind({ offer: offer(), now: at('2026-02-03T09:00:00Z'), settings })).toBe(false)
  })

  it('går bare én gang', () => {
    const reminded = offer({ reminded_at: '2026-02-06T06:00:00Z' })
    expect(shouldRemind({ offer: reminded, now: at('2026-02-07T06:00:00Z'), settings })).toBe(false)
  })

  it('går ikke på et tilbud som allerede er besvart eller utløpt', () => {
    expect(shouldRemind({ offer: offer({ status: 'declined' }), now: at('2026-02-07T06:00:00Z'), settings })).toBe(false)
    expect(shouldRemind({ offer: offer(), now: at('2026-02-09T06:00:00Z'), settings })).toBe(false)
  })

  it('går ikke på korte tilbud — de er en påminnelse i seg selv', () => {
    const short = offer({ sent_at: '2026-03-02T09:00:00Z', expires_at: '2026-03-04T09:00:00Z' })
    expect(shouldRemind({ offer: short, now: at('2026-03-03T09:00:00Z'), settings })).toBe(false)
  })

  it('er slått av når timene står på null', () => {
    expect(shouldRemind({
      offer: offer(),
      now: at('2026-02-07T06:00:00Z'),
      settings: { ...settings, reminder_hours: 0 },
    })).toBe(false)
  })
})
