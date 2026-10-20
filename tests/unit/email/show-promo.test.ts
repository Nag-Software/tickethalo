// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { bodyToHtml, showPromoEmail } from '@/lib/email/show-promo'

const base = {
  clubName: 'Crønch & Co',
  subject: 'New show',
  body: 'Hello <friends>\nSecond line\n\nTickets at https://tickethalo.com/events/a?x=1&y=2.',
  showTitle: 'Late show',
  posterUrl: 'https://cdn.example.test/poster.jpg',
  ticketUrl: 'https://tickethalo.com/events/a',
  unsubscribeUrl: 'https://tickethalo.com/unsubscribe/abc',
}

describe('showPromoEmail', () => {
  it('turns blank lines into paragraphs and escapes the club’s text', () => {
    const html = bodyToHtml(base.body)
    expect(html.match(/<p /g)).toHaveLength(2)
    expect(html).toContain('Hello &lt;friends&gt;<br />Second line')
    expect(html).toContain('href="https://tickethalo.com/events/a?x=1&amp;y=2"')
    expect(html).not.toContain('y=2.<')
  })

  it('has the poster, a ticket button and the recipient’s own unsubscribe link', () => {
    const email = showPromoEmail(base)
    expect(email.subject).toBe('New show')
    expect(email.html).toContain('src="https://cdn.example.test/poster.jpg"')
    expect(email.html).toContain('Crønch &amp; Co')
    expect(email.html).toContain('href="https://tickethalo.com/events/a"')
    expect(email.html).toContain('href="https://tickethalo.com/unsubscribe/abc"')
    expect(email.text).toContain('Unsubscribe: https://tickethalo.com/unsubscribe/abc')
  })

  it('leaves the poster out when there is none, and the link dead in a preview', () => {
    const email = showPromoEmail({ ...base, posterUrl: null, unsubscribeUrl: null })
    expect(email.html).not.toContain('<img')
    expect(email.html).toContain('href="#"')
    expect(email.text).not.toContain('Unsubscribe:')
  })
})
