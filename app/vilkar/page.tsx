import Link from 'next/link'
import { LegalPage, LegalSection } from '@/components/public/legal-page'

export const metadata = {
  title: 'Platform terms — Tickethalo',
  description: 'What Tickethalo does, and what the comedy club does.',
}

const UPDATED = '21 August 2026'
const SUPPORT_EMAIL = 'hei@tickethalo.com'

/**
 * Tickethalos egen rolle: formidler av adgang til klubbens arrangementer, og
 * leverandør av teknikken som gjør formidlingen mulig. Provisjonen er
 * vederlag for formidlingen — ikke en plattform- eller abonnementsavgift.
 * Ordbruken her er en del av strukturen og bør ikke endres uten grunn.
 */
export default function PlatformTermsPage() {
  return (
    <LegalPage
      title="Platform terms"
      intro="What Tickethalo is, what we do, and where our responsibility ends."
      updated={UPDATED}
    >
      <LegalSection title="Our role">
        <p>
          Tickethalo is a <strong>ticket agent</strong>. We present comedy shows, handle the ticket
          purchase and the payment technology, issue tickets, and settle the ticket revenue to the
          organiser. The platform exists to make that intermediation work.
        </p>
        <p>
          We are not the organiser and not the seller of any show. Each show is sold by the comedy
          club named on the event page, and the purchase agreement is between the buyer and that
          club. See the{' '}
          <Link href="/kjopsvilkar" className="underline underline-offset-2">
            terms of purchase
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="What the organiser is responsible for">
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>Setting the ticket price and the capacity of the show</li>
          <li>Staging the show, including the venue and the line-up</li>
          <li>Cancellations, changes and refunds</li>
          <li>Claims from ticket buyers relating to the event</li>
          <li>Its own obligations as a seller under Norwegian law</li>
        </ul>
      </LegalSection>

      <LegalSection title="What Tickethalo is responsible for">
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>Presenting the show and taking the ticket purchase</li>
          <li>Issuing the ticket and delivering it by email</li>
          <li>The payment technology, through our payment provider Stripe</li>
          <li>Settling the ticket revenue to the organiser</li>
          <li>Keeping the platform available and the data secure</li>
        </ul>
        <p>
          We do not guarantee that a show takes place, and we are not liable for the organiser&rsquo;s
          performance of the event.
        </p>
      </LegalSection>

      <LegalSection title="Our fee">
        <p>
          Tickethalo receives an <strong>agency commission of 10 % of the ticket price</strong> for
          each ticket sold through the platform. The commission is the organiser&rsquo;s cost, not the
          buyer&rsquo;s: nothing is added to the ticket price at checkout, and the payment
          processing cost is covered out of our commission.
        </p>
        <p>
          The commission is payment for intermediating admission to the organiser&rsquo;s event. It
          is not a subscription, a platform fee or a licence fee, and there is no separate charge
          for using the platform.
        </p>
      </LegalSection>

      <LegalSection title="Payments and settlement">
        <p>
          Payments are processed by Stripe. The payment is made to the organiser&rsquo;s own Stripe
          account — the ticket revenue is the organiser&rsquo;s from the moment the buyer pays, and
          does not pass through Tickethalo. We receive only our commission.
        </p>
        <p>
          Ticket revenue is paid out to the organiser after the show has taken place, so that money
          is available for refunds if a show is cancelled. Each organiser receives a settlement
          statement showing gross ticket sales, commission, refunds and the amount paid out.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Tickethalo can be reached at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>
          . For anything about a specific show, contact the organiser named on the event page.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
