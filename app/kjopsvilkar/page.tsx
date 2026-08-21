import Link from 'next/link'
import { LegalPage, LegalSection } from '@/components/public/legal-page'

export const metadata = {
  title: 'Terms of purchase — Tickethalo',
  description: 'Who you buy your ticket from, and what applies if a show is cancelled.',
}

const UPDATED = '21 August 2026'
const SUPPORT_EMAIL = 'hei@tickethalo.com'

/**
 * Avtalen mellom billettkjøper og klubb.
 *
 * Klubben er selger og arrangør. Tickethalo er billettformidler og er ikke
 * part i avtalen om selve arrangementet. Det er den reelle strukturen, og
 * denne siden er stedet den står skriftlig for kjøperen.
 */
export default function TermsOfPurchasePage() {
  return (
    <LegalPage
      title="Terms of purchase"
      intro="These terms apply when you buy a ticket through Tickethalo."
      updated={UPDATED}
    >
      <LegalSection title="Who you are buying from">
        <p>
          The comedy club named as the organiser on the event page is the <strong>seller and
          organiser</strong> of the show. Your purchase agreement is with that club. The club sets
          the ticket price, is responsible for staging the show, and is responsible for
          cancellations, changes and refunds.
        </p>
        <p>
          Tickethalo is the <strong>ticket agent</strong>: we present the show, handle the ticket
          purchase and the payment technology, issue your ticket, and settle the ticket revenue to
          the organiser. We are not a party to the agreement about the event itself.
        </p>
        <p>
          The organiser&rsquo;s name and organisation number are shown at checkout and on the ticket
          you receive by email.
        </p>
      </LegalSection>

      <LegalSection title="Price and VAT">
        <p>
          The price shown on the event page is the price you pay. No booking fee or payment
          surcharge is added — the payment cost is carried by Tickethalo and the organiser, not by
          you.
        </p>
        <p>
          Admission to cultural events such as stand-up is outside the scope of Norwegian VAT
          (merverdiavgiftsloven § 3-7), so no VAT is added to the ticket price.
        </p>
      </LegalSection>

      <LegalSection title="Your ticket">
        <p>
          You receive the ticket by email as a QR code and a ticket code. The ticket is personal and
          admits one person to the show it was issued for. Show the QR code or the ticket code at
          the door.
        </p>
        <p>
          If the ticket does not arrive, check your spam folder first and then contact us at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>
          . Delivering the ticket is our responsibility.
        </p>
      </LegalSection>

      <LegalSection title="Right of withdrawal">
        <p>
          Tickets to an event held on a specific date are exempt from the statutory right of
          withdrawal under the Norwegian Right of Withdrawal Act (angrerettloven § 22 letter m). A
          purchased ticket is therefore not refundable simply because you change your mind.
        </p>
        <p>
          The organiser may still choose to refund or exchange a ticket. Ask the organiser directly.
        </p>
      </LegalSection>

      <LegalSection title="If the show is cancelled or changed">
        <p>
          If the organiser cancels the show, you are refunded the full ticket price to the payment
          method you used. You do not need to do anything — the refund is initiated by the
          organiser.
        </p>
        <p>
          If the show is moved to another date or venue, the organiser will inform you. Whether a
          moved show entitles you to a refund is decided by the organiser.
        </p>
        <p>
          Changes to the line-up are not in themselves grounds for a refund. Comedy line-ups change,
          and the ticket is to the show, not to a named performer — unless the organiser has stated
          otherwise for that show.
        </p>
      </LegalSection>

      <LegalSection title="Complaints and contact">
        <p>
          Questions about the show itself — the programme, the venue, cancellations, refunds — go to
          the organiser. Their contact address is on your ticket email.
        </p>
        <p>
          Questions about the ticket purchase, the payment or a ticket that never arrived go to
          Tickethalo at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <p>
          If a dispute with the organiser cannot be resolved, you may bring it to the Norwegian
          Consumer Authority (Forbrukertilsynet).
        </p>
      </LegalSection>

      <LegalSection title="Personal data">
        <p>
          We process your name, email address and purchase in order to issue the ticket and admit
          you at the door. See our{' '}
          <Link href="/personvern" className="underline underline-offset-2">
            privacy policy
          </Link>{' '}
          for what is stored, for how long, and who has access.
        </p>
        <p>
          Tickethalo&rsquo;s own role and terms as a ticket agent are described in our{' '}
          <Link href="/vilkar" className="underline underline-offset-2">
            platform terms
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  )
}
