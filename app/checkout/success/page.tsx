import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { stripe } from '@/lib/stripe'
import { finalizeCheckoutSession } from '@/lib/checkout/finalize'
import { PublicHeader } from '@/components/public/public-header'

export const metadata = { title: 'Takk for kjøpet — humor.events' }

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>
}) {
  const { session_id } = await searchParams
  const session = session_id ? await getSession(session_id) : null
  const completion = session ? await finalizeCheckoutSession(session) : null
  const clubHomeHref = session?.metadata?.club_slug ? `/${session.metadata.club_slug}` : '/'

  return (
    <main className="min-h-svh bg-[#f3ead9] text-zinc-950">
      <PublicHeader transparent tone="light" eventsHref={clubHomeHref} />
      <section className="mx-auto flex max-w-6xl items-center justify-center px-4 py-16 md:px-6 lg:px-8">
      <div className="w-full max-w-lg border-2 border-zinc-950 bg-[#fbf7ec] p-8 text-center shadow-[8px_8px_0_rgba(24,24,27,0.14)]">
        <CheckCircle2 className="mx-auto size-12 text-[#b83224]" />
        <h1 className="mt-5 text-4xl font-black uppercase tracking-tight">Takk for kjøpet!</h1>
        <p className="mt-2 font-medium text-zinc-700">
          {completion?.result === 'created'
            ? completion.emailSent
              ? 'Billetten din er sendt på e-post.'
              : 'Betalingen er godkjent, men billett-eposten kunne ikke sendes automatisk.'
            : completion?.result === 'duplicate'
              ? 'Billetten er allerede opprettet og sendt tidligere.'
              : 'Billetten din sendes på e-post.'}
        </p>
        {session && (
          <div className="mt-6 grid gap-2 border-2 border-zinc-950 bg-[#f3ead9] p-4 text-left text-sm font-medium">
            <div><span className="text-zinc-500">Show:</span> {session.metadata?.show_title ?? 'humor.events'}</div>
            {session.metadata?.show_date && <div><span className="text-zinc-500">Dato:</span> {session.metadata.show_date}</div>}
            <div><span className="text-zinc-500">E-post:</span> {session.customer_details?.email ?? session.customer_email ?? 'Ikke tilgjengelig'}</div>
            {completion?.ticketCode && <div><span className="text-zinc-500">Billettkode:</span> <span className="font-mono">{completion.ticketCode}</span></div>}
          </div>
        )}
        <div className="mt-7 flex justify-center gap-2">
          <Button asChild className="rounded-none border-2 border-zinc-950 bg-[#b83224] font-bold text-white hover:bg-[#9f2d21]"><Link href={clubHomeHref}>Tilbake til klubben</Link></Button>
          <Button asChild variant="outline" className="rounded-none border-2 border-zinc-950 bg-transparent font-bold hover:bg-zinc-950 hover:text-white"><Link href="/">Forsiden</Link></Button>
        </div>
      </div>
      </section>
    </main>
  )
}

async function getSession(sessionId: string) {
  try {
    return await stripe.checkout.sessions.retrieve(sessionId)
  } catch (error) {
    console.error('[Checkout Success] Could not retrieve session:', error)
    return null
  }
}