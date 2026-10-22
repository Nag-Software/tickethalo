// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { lineupDetailRows, lineupHost, lineupRecipients, pinnedInfo, type LineupArtist } from '@/lib/lineup-communication'
import { lineupGroupInviteTemplate, lineupMessageTemplate, messageParagraphs } from '@/lib/email/lineup-templates'

const artists: LineupArtist[] = [
  { id: 'anna', full_name: 'Anna Berg', stage_name: null, email: 'anna@test.test', whatsapp_number: '4791234567' },
  { id: 'ben', full_name: 'Ben Dahl', stage_name: 'Benny', email: 'ben@test.test', whatsapp_number: null },
  { id: 'cleo', full_name: 'Cleo', stage_name: null, email: null, whatsapp_number: null },
  { id: 'dan', full_name: 'Dan', stage_name: null, email: 'dan@test.test', whatsapp_number: null },
]

describe('lineupRecipients', () => {
  it('is the confirmed line-up, once each, in line-up order', () => {
    const recipients = lineupRecipients(
      [
        { artist_id: 'ben', status: 'confirmed' },
        { artist_id: 'anna', status: 'confirmed' },
        { artist_id: 'ben', status: 'confirmed' },
        { artist_id: 'dan', status: 'cancelled' },
      ],
      artists,
    )
    expect(recipients.map((recipient) => recipient.name)).toEqual(['Benny', 'Anna Berg'])
  })

  it('keeps the line-up after the show, and leaves out those with no email', () => {
    const recipients = lineupRecipients(
      [
        { artist_id: 'anna', status: 'completed' },
        { artist_id: 'ben', status: 'paid' },
        { artist_id: 'cleo', status: 'confirmed' },
      ],
      artists,
    )
    expect(recipients.map((recipient) => recipient.artistId)).toEqual(['anna', 'ben'])
  })

  it('can be narrowed to confirmed only, as the reminder is', () => {
    expect(lineupRecipients([{ artist_id: 'anna', status: 'completed' }], artists, ['confirmed'])).toEqual([])
  })
})

describe('lineupHost and the pinned info', () => {
  const requirements = [
    { id: 'req-spot', role_name: 'Stand-up' },
    { id: 'req-host', role_name: 'MC' },
  ]
  const spots = [
    { artist_id: 'ben', show_requirement_id: 'req-spot', status: 'confirmed' as const },
    { artist_id: 'anna', show_requirement_id: 'req-host', status: 'confirmed' as const },
  ]

  it('finds whoever holds the host spot, by any name for it', () => {
    expect(lineupHost(requirements, spots, artists)).toEqual({ artistId: 'anna', name: 'Anna Berg', whatsapp: '4791234567' })
    expect(lineupHost(requirements, [spots[0]], artists)).toBeNull()
  })

  const details = {
    title: 'Friday Laughs',
    date: '2026-10-24',
    startTime: '20:00',
    arrivalTime: null,
    venue: 'Crønch',
    address: 'Storgata 1, Oslo',
    clubName: 'Crønch Comedy',
    clubEmail: 'hei@cronch.test',
    host: { artistId: 'anna', name: 'Anna Berg', whatsapp: '4791234567' },
    groupLink: null,
  }

  it('is in Tom’s order: date, venue, address, start, contacts', () => {
    expect(pinnedInfo(details).split('\n').map((line) => line.split(':')[0])).toEqual([
      'Friday Laughs', 'Date', 'Venue', 'Address', 'Show starts', 'Club contact', 'Host',
    ])
    expect(pinnedInfo(details)).toContain('Club contact: Crønch Comedy · hei@cronch.test')
    expect(pinnedInfo(details)).toContain('Host: Anna Berg · +4791234567')
  })

  it('tells the host they are hosting instead of their own number', () => {
    expect(lineupDetailRows(details, 'anna')).toContainEqual(['Host', 'You are hosting'])
    expect(lineupDetailRows({ ...details, host: null })).not.toContainEqual(expect.arrayContaining(['Host']))
  })
})

describe('the line-up emails', () => {
  it('escapes the club’s text and keeps its paragraphs', () => {
    expect(messageParagraphs('Hi <b>all</b>\nsee you\n\nBring & smile')).toBe(
      messageParagraphs('Hi <b>all</b>\nsee you') + messageParagraphs('Bring & smile'),
    )
    expect(messageParagraphs('<script>x</script>')).not.toContain('<script>')
    expect(messageParagraphs('a\nb')).toContain('a<br />b')
  })

  it('names the sender and links to the portal thread', () => {
    const email = lineupMessageTemplate({
      recipientName: 'Benny',
      clubName: 'Crønch Comedy',
      senderName: 'Kari',
      showId: 'show-1',
      showTitle: 'Friday Laughs',
      showDate: '2026-10-24',
      body: 'Doors open at 19:00.',
    })
    expect(email.subject).toBe('Friday Laughs: message from Crønch Comedy')
    expect(email.text).toContain('— Kari, Crønch Comedy')
    expect(email.text).toContain('/artist-app/messages/show-1')
  })

  it('puts only the group link in the invite, never a phone number', () => {
    const email = lineupGroupInviteTemplate({
      recipientName: 'Benny',
      clubName: 'Crønch Comedy',
      showId: 'show-1',
      showTitle: 'Friday Laughs',
      showDate: '2026-10-24',
      link: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv',
    })
    expect(email.html).toContain('href="https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv"')
    expect(email.html).not.toMatch(/wa\.me/)
  })
})
