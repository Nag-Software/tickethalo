import Link from 'next/link'
import { LegalPage, LegalSection } from '@/components/public/legal-page'

export const metadata = {
  title: 'Privacy — Tickethalo',
  description: 'What we store when you buy a ticket, why, and for how long.',
}

const UPDATED = '24 October 2026'
const SUPPORT_EMAIL = 'hei@tickethalo.com'

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      intro="What we store when you buy a ticket or perform at a show, why we store it, and who can see it."
      updated={UPDATED}
    >
      <LegalSection title="What we store">
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>Your name and email address, from the payment</li>
          <li>Your phone number, if you give it at checkout</li>
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
          <li>Resend — sending your ticket, and emails from organisers you have signed up to</li>
          <li>Vercel — hosting the website</li>
        </ul>
      </LegalSection>

      <LegalSection title="Emails from the organiser">
        <p>
          When you buy a ticket you can tick a box to get emails from the organiser about upcoming
          shows. It is off unless you tick it. If you do, your name, email address and phone number
          (if you gave one) are added to that organiser&rsquo;s email list, together with when you
          said yes and what you said yes to. Organisers can also import people who have agreed to
          hear from them elsewhere, and must confirm that they have before they can.
        </p>
        <p>
          The list belongs to the organiser, who decides what to send and is responsible for it.
          Tickethalo stores the list and sends the emails on the organiser&rsquo;s behalf. Each
          organiser has their own list — saying yes to one does not put you on another. The legal
          basis is your consent.
        </p>
        <p>
          Every email has an unsubscribe link, and unsubscribing takes effect at once. We keep your
          address marked as unsubscribed so it is not added again by mistake. To be removed
          completely, ask the organiser or write to us.
        </p>
      </LegalSection>

      <LegalSection title="Ads on Facebook and Instagram">
        <p>
          If you tick the box for emails, you can also tick a second box to see relevant ads from the
          organiser on Facebook and Instagram. It is off unless you tick it, and saying yes to emails
          does not mean yes to ads. Organisers can also import people who have agreed to ads
          elsewhere, and must confirm that they have before they can.
        </p>
        <p>
          If you say yes, the organiser can download your email address, phone number and name and
          upload them to Meta (Facebook and Instagram) as a customer list. Meta hashes the data when it
          is uploaded and uses it to find your account, so the organiser can show you their ads. Meta
          processes the data on the organiser&rsquo;s behalf. The organiser decides whether to do this and is responsible for it; Tickethalo only
          prepares the file. The legal basis is your consent.
        </p>
        <p>
          You can withdraw at any time, with the link at the bottom of the organiser&rsquo;s emails or by
          asking the organiser. Unsubscribing from the emails withdraws it too. After that you are left
          out of new downloads, and the organiser must replace the list they have uploaded to Meta.
        </p>
      </LegalSection>

      <LegalSection title="If you perform at a show">
        <p>
          When a club books you, it can send messages to everyone on the line-up of that show. They
          come by email and are kept in your comedian portal, together with when you opened them,
          so you can find them again. Replies go by email straight to the club. When you host a show,
          the rest of that line-up sees your email address as the host contact. The legal basis is
          the booking agreement between you and the club.
        </p>
        <p>
          You can add a WhatsApp number to your profile. It is optional, and it is only saved if you
          tick the box next to it. Clubs that book you can then see the number and use it to add you
          to a group chat for the show. When you host a show, the rest of that line-up sees your
          WhatsApp number too, next to your email address. The legal basis is your consent.
        </p>
        <p>
          A WhatsApp group is run by WhatsApp, not by Tickethalo, and everyone in it can see your
          number. To withdraw your consent, clear the number or untick the box in your profile — it
          is deleted from Tickethalo at once. A club that has already saved it, or added you to a
          group, keeps what it has; ask the club to remove it.
        </p>
      </LegalSection>

      <LegalSection title="How long">
        <p>
          Purchase and ticket records are kept for as long as accounting law requires — in Norway,
          five years after the end of the financial year. After that they are deleted or anonymised.
        </p>
        <p>
          You stay on an organiser&rsquo;s email list until you unsubscribe or ask to be deleted. A
          yes to ads lasts until you withdraw it or unsubscribe.
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
