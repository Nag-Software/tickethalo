// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  nextReminderRunDate,
  reminderDueToday,
  reminderEnabled,
  reminderPlan,
  reminderSendDate,
  type ReminderShow,
} from '@/lib/lineup-reminders'

const show = (date: string, extra: Partial<ReminderShow> = {}): ReminderShow => ({
  date,
  status: 'published',
  deleted_at: null,
  is_template: false,
  lineup_reminder_enabled: null,
  ...extra,
})

/** Kjøringen kl. 06:00 UTC den gitte dagen. */
const run = (day: string) => new Date(`${day}T06:00:00Z`)

describe('reminderDueToday', () => {
  it('sends from five days before until the day before', () => {
    expect(reminderDueToday(show('2026-11-20'), true, run('2026-11-14'))).toBe(false) // 6 dager før
    expect(reminderDueToday(show('2026-11-20'), true, run('2026-11-15'))).toBe(true) // 5
    expect(reminderDueToday(show('2026-11-20'), true, run('2026-11-19'))).toBe(true) // 1
    expect(reminderDueToday(show('2026-11-20'), true, run('2026-11-20'))).toBe(false) // showdagen
  })

  it('counts days in Oslo across the switch to summer time (29 March 2026)', () => {
    // 2. april er fem dager etter 28. mars, og klokken stilles natt til 29.
    expect(reminderDueToday(show('2026-04-02'), true, run('2026-03-28'))).toBe(true)
    expect(reminderDueToday(show('2026-04-02'), true, run('2026-03-27'))).toBe(false)
  })

  it('counts days in Oslo across the switch back (25 October 2026)', () => {
    expect(reminderDueToday(show('2026-10-30'), true, run('2026-10-25'))).toBe(true)
    expect(reminderDueToday(show('2026-10-30'), true, run('2026-10-24'))).toBe(false)
  })

  it('uses the Oslo date, not the UTC date, late in the evening', () => {
    // 23:30 UTC 14. november er 00:30 den 15. i Oslo — fem dager før.
    expect(reminderDueToday(show('2026-11-20'), true, new Date('2026-11-14T23:30:00Z'))).toBe(true)
    // 22:30 UTC i juli er 00:30 neste dag i Oslo (sommertid, +2).
    expect(reminderDueToday(show('2026-07-20'), true, new Date('2026-07-14T22:30:00Z'))).toBe(true)
    expect(reminderDueToday(show('2026-07-20'), true, new Date('2026-07-14T21:30:00Z'))).toBe(false)
  })

  it('follows the show, then the club default', () => {
    expect(reminderDueToday(show('2026-11-20'), false, run('2026-11-16'))).toBe(false)
    expect(reminderDueToday(show('2026-11-20', { lineup_reminder_enabled: true }), false, run('2026-11-16'))).toBe(true)
    expect(reminderDueToday(show('2026-11-20', { lineup_reminder_enabled: false }), true, run('2026-11-16'))).toBe(false)
    expect(reminderEnabled({ lineup_reminder_enabled: null }, undefined)).toBe(true)
  })

  it('never reminds about a cancelled, played, deleted or template show', () => {
    const day = run('2026-11-16')
    expect(reminderDueToday(show('2026-11-20', { status: 'cancelled' }), true, day)).toBe(false)
    expect(reminderDueToday(show('2026-11-20', { status: 'completed' }), true, day)).toBe(false)
    expect(reminderDueToday(show('2026-11-20', { deleted_at: '2026-11-01T00:00:00Z' }), true, day)).toBe(false)
    expect(reminderDueToday(show('2026-11-20', { is_template: true }), true, day)).toBe(false)
  })
})

describe('reminderPlan', () => {
  it('names the day it goes out', () => {
    expect(reminderSendDate('2026-11-20')).toBe('2026-11-15')
    expect(reminderPlan(show('2026-11-20'), true, new Date('2026-11-01T12:00:00Z'))).toEqual({ kind: 'scheduled', on: '2026-11-15' })
  })

  it('says the next run when the window is already open', () => {
    // Etter dagens kjøring: neste morgen.
    expect(reminderPlan(show('2026-11-20'), true, new Date('2026-11-17T12:00:00Z'))).toEqual({ kind: 'scheduled', on: '2026-11-18' })
    // Før dagens kjøring: i dag.
    expect(reminderPlan(show('2026-11-20'), true, new Date('2026-11-17T05:00:00Z'))).toEqual({ kind: 'scheduled', on: '2026-11-17' })
  })

  it('is too late when the next run is the show day', () => {
    expect(reminderPlan(show('2026-11-20'), true, new Date('2026-11-19T12:00:00Z'))).toEqual({ kind: 'closed' })
  })

  it('is off when turned off, and closed for a cancelled show', () => {
    expect(reminderPlan(show('2026-11-20'), false)).toEqual({ kind: 'off' })
    expect(reminderPlan(show('2026-11-20', { status: 'cancelled' }), true, new Date('2026-11-01T12:00:00Z'))).toEqual({ kind: 'closed' })
  })

  it('finds the next run in Oslo', () => {
    expect(nextReminderRunDate(new Date('2026-03-28T07:00:00Z'))).toBe('2026-03-29')
    expect(nextReminderRunDate(new Date('2026-10-25T05:59:00Z'))).toBe('2026-10-25')
  })
})
