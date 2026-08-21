import Link from 'next/link'
import { LegalPage, LegalSection } from '@/components/public/legal-page'

export const metadata = {
  title: 'Privacy — Tickethalo',
  description: 'What we store when you buy a ticket, why, and for how long.',
}

const UPDATED = '21 August 2026'
const SUPPORT_EMAIL = 'hei@tickethalo.com'

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      intro="What we store when you buy a ticket, why we store it, and who can see it."
      updated={UPDATED}
    >
      <LegalSection title="What we store">
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>Your name and email address, from the payment</li>
          <li>Which show you bought a ticket for, and when</li>
          <li>The ticket code, and whether the ticket has been scanned at the door</li>
          <li>The amount paid, the currency and a payment reference</li>
        </ul>
        <p>
          We never see or store your card number. Card details are handled by Stripe, our payment
          provider.
        </p>
      </LegalSection>

      <LegalSection title="Why we store it">
        <p>
          To issue your ticket, admit you at the door, handle refunds, and keep the accounting
          records the organiser and Tickethalo are required to keep. The legal basis is the
          performance of your purchase agreement, and our legal obligation to keep sales records.
        </p>
      </LegalSection>

      <LegalSection title="Who has access">
        <p>
          The organiser of the show you bought a ticket for can see the purchase, in order to run
          the event and handle refunds. Organisers cannot see purchases for other organisers&rsquo;
          shows.
        </p>
        <p>We use these providers to run the service:</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>Supabase — database and file storage, hosted in the EU</li>
          <li>Stripe — payments and payment records</li>
          <li>Resend — sending your ticket by email</li>
          <li>Vercel — hosting the website</li>
        </ul>
      </LegalSection>

      <LegalSection title="How long">
        <p>
          Purchase and ticket records are kept for as long as accounting law requires — in Norway,
          five years after the end of the financial year. After that they are deleted or anonymised.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>
          You can ask for a copy of the data we hold about you, ask for it to be corrected, or ask
          for it to be deleted where we are not required to keep it. Write to{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <p>
          You can also complain to the Norwegian Data Protection Authority (Datatilsynet). What
          Tickethalo and the organiser are each responsible for is described in our{' '}
          <Link href="/vilkar" className="underline underline-offset-2">
            platform terms
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  )
}
