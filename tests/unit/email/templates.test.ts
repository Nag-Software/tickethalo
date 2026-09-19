import { describe, expect, it } from 'vitest'
import {
  bookingConfirmedTemplate,
  bookingOfferTemplate,
  lineupFullTemplate,
  offerWithdrawnByClubTemplate,
  removedFromLineupTemplate,
  showCancelledTemplate,
  showDateLabel,
} from '@/lib/email/templates'

describe('showDateLabel', () => {
  it('turns the stored ISO date into a date people read', () => {
    const label = showDateLabel('2026-10-17')
    expect(label).toMatch(/Saturday,? 17 October 2026/)
    expect(label).not.toContain('2026-10-17')
  })

  it('reads a timestamp by its date part and never slips a day', () => {
    expect(showDateLabel('2026-10-17T00:00:00+02:00')).toMatch(/17 October 2026/)
    expect(showDateLabel('2026-01-01')).toMatch(/Thursday,? 1 January 2026/)
  })

  it('writes Norwegian for the ticket email', () => {
    expect(showDateLabel('2026-10-17', 'nb-NO')).toMatch(/lørdag 17\. oktober 2026/)
  })

  it('leaves anything that is not an ISO date alone', () => {
    expect(showDateLabel('Friday 14 March')).toBe('Friday 14 March')
    expect(showDateLabel('')).toBe('')
    expect(showDateLabel(null)).toBe('')
  })
})

describe('comedian templates use the readable date', () => {
  it('offer and confirmation no longer print the raw ISO date', () => {
    const offer = bookingOfferTemplate({
      full_name: 'Ida', show_title: 'Backstage', show_date: '2026-10-17', response_url: 'https://x.test/o',
    })
    const confirmed = bookingConfirmedTemplate({ full_name: 'Ida', show_title: 'Backstage', show_date: '2026-10-17' })

    for (const template of [offer, confirmed]) {
      expect(template.html).toContain('17 October 2026')
      expect(template.text).toContain('17 October 2026')
      expect(template.html).not.toContain('2026-10-17')
      expect(template.text).not.toContain('2026-10-17')
    }
  })

  it('says who booked whom when the club put the comedian on the lineup', () => {
    const byClub = bookingConfirmedTemplate({ full_name: 'Ida', show_title: 'Backstage', show_date: '2026-10-17', added_by_club: true })
    const byReply = bookingConfirmedTemplate({ full_name: 'Ida', show_title: 'Backstage', show_date: '2026-10-17' })
    expect(byClub.text).toContain('The club has put you on the lineup.')
    expect(byReply.text).toContain('The club has been told.')
  })
})

describe('notices when the club changes something', () => {
  const base = { full_name: 'Ida Brattås', show_title: 'Backstage Stand Up', show_date: '2026-10-17', club_name: 'Backstage' }

  it('tells a booked comedian the show is cancelled and the evening is free', () => {
    const template = showCancelledTemplate({ ...base, booked: true })
    expect(template.subject).toBe('Show cancelled: Backstage Stand Up')
    expect(template.text).toContain('Backstage has cancelled Backstage Stand Up on')
    expect(template.text).toContain('Your spot on the lineup is cancelled with it')
    expect(template.html).toContain('This show is cancelled')
  })

  it('tells a comedian with only an open offer that the offer no longer applies', () => {
    const template = showCancelledTemplate({ ...base, booked: false })
    expect(template.text).toContain('The offer we sent you no longer applies')
    expect(template.text).not.toContain('Your spot on the lineup')
    expect(template.html).toContain('This offer no longer applies')
  })

  it('separates being removed from the lineup from a withdrawn offer', () => {
    expect(removedFromLineupTemplate(base).subject).toBe('Lineup change: Backstage Stand Up')
    expect(removedFromLineupTemplate(base).text).toContain('your spot has been removed')
    expect(offerWithdrawnByClubTemplate(base).subject).toBe('Offer withdrawn: Backstage Stand Up')
    expect(offerWithdrawnByClubTemplate(base).text).toContain('the link in the earlier email no longer works')
  })

  it('falls back to "The club" and escapes what the club typed', () => {
    const template = showCancelledTemplate({
      full_name: '<b>Ida</b>', show_title: 'Laughs & <script>', show_date: '2026-10-17', club_name: null, booked: true,
    })
    expect(template.text).toContain('The club has cancelled')
    expect(template.html).not.toContain('<script>')
    expect(template.html).toContain('Laughs &amp; &lt;script&gt;')
    expect(template.html).toContain('&lt;b&gt;Ida&lt;/b&gt;')
  })
})

// Showet publiserte seg selv før — uten plakat, tekst og billettsalg. Nå får
// klubben denne e-posten i stedet, og publiserer selv.
describe('lineupFullTemplate', () => {
  const base = {
    full_name: 'Kari',
    show_title: 'Backstage Stand Up',
    show_date: '2026-10-17',
    lineup: ['Ida', 'Jonas'],
    missing: ['a poster', 'a description', 'a ticket price'],
    payout_ready: true,
    show_url: 'https://x.test/admin-app/shows/1',
  }

  it('asks the club to publish and says nothing is live yet', () => {
    const template = lineupFullTemplate(base)
    expect(template.subject).toBe('Line-up is booked – Publish? Backstage Stand Up')
    expect(template.text).toContain('The show is not published yet')
    expect(template.text).toContain('Ida, Jonas')
    expect(template.text).toContain('https://x.test/admin-app/shows/1')
    expect(template.html).toContain('Review and publish')
    expect(template.text).not.toContain('2026-10-17')
  })

  it('lists what the event page still needs, or says it is complete', () => {
    expect(lineupFullTemplate(base).text).toContain('still needs a poster, a description and a ticket price.')
    expect(lineupFullTemplate({ ...base, missing: ['a poster'] }).text).toContain('still needs a poster.')
    expect(lineupFullTemplate({ ...base, missing: [] }).text).toContain('has everything it needs')
  })

  it('warns about the payout setup only when it blocks publishing', () => {
    expect(lineupFullTemplate(base).text).not.toContain('payout setup')
    expect(lineupFullTemplate({ ...base, payout_ready: false }).text).toContain('payout setup')
  })

  it('escapes what the club typed and tolerates a missing name', () => {
    const template = lineupFullTemplate({ ...base, full_name: null, show_title: 'Laughs & <script>', lineup: ['<b>Ida</b>'] })
    expect(template.text.startsWith('Hi\n')).toBe(true)
    expect(template.html).not.toContain('<script>')
    expect(template.html).toContain('&lt;b&gt;Ida&lt;/b&gt;')
  })
})
