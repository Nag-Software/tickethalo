// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryDb } from './memory-db'

const state: { db: ReturnType<typeof memoryDb> | null } = { db: null }
const sentEmails: Array<{ to: string; subject: string; text: string; replyTo?: string }> = []

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/lib/email/bulk', () => {
  const queues = new Map<string, Array<{ email: string; name: string | null }>>()
  return {
    createCampaign: vi.fn(async (input: { recipients: Array<{ email: string; name?: string | null }> }) => {
      const id = `campaign-${queues.size + 1}`
      queues.set(id, input.recipients.map((recipient) => ({ email: recipient.email.toLowerCase(), name: recipient.name ?? null })))
      return { ok: true, campaignId: id, recipientCount: input.recipients.length }
    }),
    drainCampaign: vi.fn(async (id: string, options: { render: (recipient: { email: string; name: string | null; contact_id: null; unsubscribe_url: null }) => { to: string; subject: string; text: string; replyTo?: string } }) => {
      const queue = queues.get(id) ?? []
      for (const recipient of queue) {
        const payload = options.render({ ...recipient, contact_id: null, unsubscribe_url: null })
        sentEmails.push({ to: payload.to, subject: payload.subject, text: payload.text, replyTo: payload.replyTo })
      }
      queues.set(id, [])
      return { status: 'sent', recipientCount: queue.length, sent: queue.length, failed: 0, remaining: 0 }
    }),
  }
})

import { sendDueLineupReminders } from '@/lib/lineup-messages'

function seed(overrides: { show?: Record<string, unknown>; clubDefault?: boolean } = {}) {
  return {
    shows: [{
      id: 'show-1',
      title: 'Friday Laughs',
      date: '2026-11-20',
      start_time: '20:00:00',
      venue_name: 'Crønch',
      venue_address: 'Storgata 1, Oslo',
      currency: 'NOK',
      status: 'published',
      deleted_at: null,
      is_template: false,
      club_id: 'club-1',
      lineup_reminder_enabled: null,
      lineup_arrival_time: '19:15:00',
      lineup_change_notice: null,
      lineup_group_link: null,
      ...overrides.show,
    }],
    clubs: [{
      id: 'club-1',
      name: 'Crønch Comedy',
      support_email: 'hei@cronch.test',
      contact_email: null as string | null,
      contact_phone: null as string | null,
      lineup_reminder_default: overrides.clubDefault ?? true,
    }],
    show_requirements: [
      { id: 'req-host', show_id: 'show-1', role_name: 'Host', lineup_position: 0, compensation_type: 'fixed', compensation_amount: 150000, compensation_percent: null },
      { id: 'req-spot', show_id: 'show-1', role_name: 'Stand-up', lineup_position: 1, compensation_type: 'fixed', compensation_amount: 100000, compensation_percent: null },
    ],
    confirmed_spots: [
      { id: 'spot-host', show_id: 'show-1', artist_id: 'anna', show_requirement_id: 'req-host', status: 'confirmed', lineup_reminder_sent_at: null },
      { id: 'spot-ben', show_id: 'show-1', artist_id: 'ben', show_requirement_id: 'req-spot', status: 'confirmed', lineup_reminder_sent_at: null },
      { id: 'spot-gone', show_id: 'show-1', artist_id: 'cleo', show_requirement_id: 'req-spot', status: 'cancelled', lineup_reminder_sent_at: null },
    ],
    artists: [
      { id: 'anna', full_name: 'Anna Berg', stage_name: null, email: 'anna@test.test', whatsapp_number: '4791234567', whatsapp_consent_at: '2026-10-01T00:00:00Z' },
      { id: 'ben', full_name: 'Ben Dahl', stage_name: 'Benny', email: 'ben@test.test', whatsapp_number: null, whatsapp_consent_at: null },
      { id: 'cleo', full_name: 'Cleo', stage_name: null, email: 'cleo@test.test', whatsapp_number: null, whatsapp_consent_at: null },
    ],
    lineup_messages: [] as Array<Record<string, unknown>>,
    lineup_message_recipients: [] as Array<Record<string, unknown>>,
  }
}

const run = (day: string) => new Date(`${day}T06:00:00Z`)

describe('sendDueLineupReminders', () => {
  let tables: ReturnType<typeof seed>

  beforeEach(() => {
    sentEmails.length = 0
    tables = seed()
    state.db = memoryDb(tables)
  })

  it('reminds the confirmed line-up five days before, with the details', async () => {
    const result = await sendDueLineupReminders(run('2026-11-15'))

    expect(result).toMatchObject({ shows: 1, reminded: 2, failed: 0 })
    expect(sentEmails.map((email) => email.to).sort()).toEqual(['anna@test.test', 'ben@test.test'])
    const ben = sentEmails.find((email) => email.to === 'ben@test.test')!
    expect(ben.subject).toMatch(/^Reminder: Friday Laughs on Friday,? 20 November 2026$/)
    expect(ben.text).toContain('Arrive by: 19:15')
    expect(ben.text).toContain('Club contact: Crønch Comedy, hei@cronch.test')
    expect(ben.text).toContain('Host: Anna Berg, anna@test.test, +4791234567')
    expect(ben.text).toMatch(/Fee: NOK\s1,000/)
    expect(ben.text).toContain('Your spot: Stand-up')
    expect(sentEmails.find((email) => email.to === 'anna@test.test')!.text).toContain('Host: You are hosting')

    expect(tables.lineup_messages).toHaveLength(1)
    expect(tables.lineup_messages[0]).toMatchObject({ kind: 'reminder', sender_name: null, recipient_count: 2 })
    expect(tables.lineup_message_recipients.map((row) => row.artist_id).sort()).toEqual(['anna', 'ben'])
  })

  it('uses the club’s own contact for the line-up, and replies go there', async () => {
    tables.clubs[0].contact_email = 'booking@cronch.test'
    tables.clubs[0].contact_phone = '4722334455'
    await sendDueLineupReminders(run('2026-11-15'))

    const ben = sentEmails.find((email) => email.to === 'ben@test.test')!
    expect(ben.text).toContain('Club contact: Crønch Comedy, booking@cronch.test, +4722334455')
    expect(ben.replyTo).toBe('booking@cronch.test')
  })

  it('leaves the host’s number out without consent', async () => {
    tables.artists[0].whatsapp_consent_at = null
    await sendDueLineupReminders(run('2026-11-15'))

    const ben = sentEmails.find((email) => email.to === 'ben@test.test')!
    expect(ben.text).toMatch(/Host: Anna Berg, anna@test\.test\n/)
  })

  it('sends only once per spot', async () => {
    await sendDueLineupReminders(run('2026-11-15'))
    sentEmails.length = 0

    const again = await sendDueLineupReminders(run('2026-11-15'))
    const nextDay = await sendDueLineupReminders(run('2026-11-16'))

    expect(again.reminded + nextDay.reminded).toBe(0)
    expect(sentEmails).toHaveLength(0)
    expect(tables.lineup_messages).toHaveLength(1)
  })

  it('reminds someone booked later the next morning, and only them', async () => {
    await sendDueLineupReminders(run('2026-11-15'))
    sentEmails.length = 0
    tables.confirmed_spots.push({ id: 'spot-cleo', show_id: 'show-1', artist_id: 'cleo', show_requirement_id: 'req-spot', status: 'confirmed', lineup_reminder_sent_at: null })

    const result = await sendDueLineupReminders(run('2026-11-17'))

    expect(result.reminded).toBe(1)
    expect(sentEmails.map((email) => email.to)).toEqual(['cleo@test.test'])
  })

  it('skips a show that is turned off, or a club that is off by default', async () => {
    tables = seed({ show: { lineup_reminder_enabled: false } })
    state.db = memoryDb(tables)
    expect((await sendDueLineupReminders(run('2026-11-15'))).reminded).toBe(0)

    tables = seed({ clubDefault: false })
    state.db = memoryDb(tables)
    expect((await sendDueLineupReminders(run('2026-11-15'))).reminded).toBe(0)
    expect(sentEmails).toHaveLength(0)
  })

  it('skips cancelled shows and runs outside the window', async () => {
    tables = seed({ show: { status: 'cancelled' } })
    state.db = memoryDb(tables)
    expect((await sendDueLineupReminders(run('2026-11-15'))).reminded).toBe(0)

    tables = seed()
    state.db = memoryDb(tables)
    expect((await sendDueLineupReminders(run('2026-11-14'))).reminded).toBe(0)
    expect((await sendDueLineupReminders(run('2026-11-20'))).reminded).toBe(0)
    expect(tables.confirmed_spots.every((spot) => spot.lineup_reminder_sent_at === null)).toBe(true)
  })

  it('can be limited to given shows', async () => {
    expect((await sendDueLineupReminders(run('2026-11-15'), { showIds: ['another-show'] })).reminded).toBe(0)
    expect((await sendDueLineupReminders(run('2026-11-15'), { showIds: ['show-1'] })).reminded).toBe(2)
  })
})
