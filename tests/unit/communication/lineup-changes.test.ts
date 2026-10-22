// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  changeCount,
  changeHeadline,
  changeLines,
  mergeChangeNotice,
  suggestedChangeMessage,
  type ChangeWatchedShow,
} from '@/lib/lineup-changes'

const show: ChangeWatchedShow = {
  date: '2026-10-24',
  start_time: '19:00:00',
  venue_name: 'Crønch',
  venue_address: 'Storgata 1, Oslo',
}

describe('mergeChangeNotice', () => {
  it('records a changed start time', () => {
    expect(mergeChangeNotice(null, show, { ...show, start_time: '20:00' })).toEqual({
      start_time: { from: '19:00', to: '20:00' },
    })
  })

  it('ignores a save that changes none of the watched fields', () => {
    expect(mergeChangeNotice(null, show, { ...show, start_time: '19:00' })).toBeNull()
  })

  it('keeps the first “from” across several saves', () => {
    const first = mergeChangeNotice(null, show, { ...show, start_time: '19:30' })
    const second = mergeChangeNotice(first, { ...show, start_time: '19:30' }, { ...show, start_time: '20:00' })
    expect(second).toEqual({ start_time: { from: '19:00', to: '20:00' } })
  })

  it('drops a field that is back where it started', () => {
    const moved = mergeChangeNotice(null, show, { ...show, start_time: '19:30' })
    expect(mergeChangeNotice(moved, { ...show, start_time: '19:30' }, show)).toBeNull()
  })

  it('keeps other fields when one goes back', () => {
    const moved = mergeChangeNotice(null, show, { ...show, date: '2026-10-25', start_time: '20:00' })
    expect(mergeChangeNotice(moved, { ...show, date: '2026-10-25', start_time: '20:00' }, { ...show, date: '2026-10-25' })).toEqual({
      date: { from: '2026-10-24', to: '2026-10-25' },
    })
  })

  it('treats the venue as one line, and a removed time as “not set”', () => {
    const notice = mergeChangeNotice(null, show, { ...show, venue_name: 'Latter', venue_address: 'Aker Brygge', start_time: null })!
    expect(notice.venue).toEqual({ from: 'Crønch, Storgata 1, Oslo', to: 'Latter, Aker Brygge' })
    expect(changeLines(notice).find((line) => line.field === 'start_time')).toMatchObject({ from: '19:00', to: 'not set' })
  })
})

describe('the copy on the tab', () => {
  it('counts the changed fields for the badge', () => {
    expect(changeCount(null)).toBe(0)
    expect(changeCount({ date: { from: '2026-10-24', to: '2026-10-25' }, venue: { from: 'A', to: 'B' } })).toBe(2)
  })

  it('says what changed, as Tom wrote it', () => {
    expect(changeHeadline({ start_time: { from: '19:00', to: '20:00' } })).toBe(
      'The time of the show was changed, remember to notify your line-up.',
    )
    expect(changeHeadline({ date: { from: 'a', to: 'b' }, start_time: { from: 'c', to: 'd' }, venue: { from: 'e', to: 'f' } })).toBe(
      'The date, time and venue of the show were changed, remember to notify your line-up.',
    )
  })

  it('suggests a message with old and new values', () => {
    const message = suggestedChangeMessage({ date: { from: '2026-10-24', to: '2026-10-25' }, start_time: { from: '19:00', to: '20:00' } }, 'Friday Laughs')
    expect(message).toContain('the date and time for Friday Laughs have changed')
    expect(message).toContain('Date: Sat 24 Oct → Sun 25 Oct')
    expect(message).toContain('Start time: 19:00 → 20:00')
  })
})
