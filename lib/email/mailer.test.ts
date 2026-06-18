import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture every payload handed to Resend so we can assert on subject + HTML.
const sendMock = vi.fn(async () => ({ data: { id: 'test-id' }, error: null }))

vi.mock('@/lib/resend', () => ({
  resend: { emails: { send: (payload: unknown) => sendMock(payload) } },
  FROM_EMAIL: 'noreply@test',
}))

import { sendBookingOfferEmail } from './mailer'

const baseOpts = {
  email: 'thomas@example.com',
  full_name: 'Thomas Søyland',
  show_title: 'Crønch Comedy',
  club_name: 'Crønch Comedy',
  spot_type: 'standup',
  venue_name: null,
  venue_address: null,
  fee_amount: null,
  currency: 'NOK',
  token: 'tok_123',
  response_url: 'https://humor.events/booking-offer/tok_123',
}

function lastPayload() {
  return sendMock.mock.calls.at(-1)?.[0] as { subject: string; html: string }
}

describe('sendBookingOfferEmail', () => {
  beforeEach(() => sendMock.mockClear())

  it('puts the date in the subject so offers do not thread together in Gmail', async () => {
    await sendBookingOfferEmail({ ...baseOpts, show_date: '2027-10-20' })
    const a = lastPayload().subject

    await sendBookingOfferEmail({ ...baseOpts, show_date: '2027-11-05' })
    const b = lastPayload().subject

    // Each subject is unique per date → separate Gmail threads → no collapsing.
    expect(a).not.toEqual(b)
    expect(a).toContain('Crønch Comedy vil booke deg')
    expect(a).toContain('2027')
  })

  it('renders the «Svar» CTA above the details table so Gmail cannot trim it away', async () => {
    await sendBookingOfferEmail({ ...baseOpts, show_date: '2027-10-20' })
    const html = lastPayload().html

    const ctaIndex = html.indexOf(baseOpts.response_url)
    const tableIndex = html.indexOf('<table')
    const boilerplateIndex = html.indexOf('Det er helt fint å takke nei')

    expect(ctaIndex).toBeGreaterThan(-1)
    expect(tableIndex).toBeGreaterThan(-1)
    // CTA must come before the table, and the table before the repeated footer.
    expect(ctaIndex).toBeLessThan(tableIndex)
    expect(tableIndex).toBeLessThan(boilerplateIndex)
  })

  it('escapes the recipient name to avoid HTML injection', async () => {
    await sendBookingOfferEmail({
      ...baseOpts,
      full_name: '<script>x</script>',
      show_date: '2027-10-20',
    })
    expect(lastPayload().html).not.toContain('<script>x</script>')
  })
})
