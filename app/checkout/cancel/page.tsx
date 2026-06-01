import Link from 'next/link'
import { XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PublicHeader } from '@/components/public/public-header'

export const metadata = { title: 'Betaling avbrutt — humor.events' }

export default async function CheckoutCancelPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; club?: string }>
}) {
  const { event, club } = await searchParams
  const eventHref = event ? (club ? `/${club}/eventer/${event}` : `/events/${event}`) : '/'
  const clubHomeHref = club ? `/${club}` : '/'

  return (
    <main className="min-h-svh bg-[#f3ead9] text-zinc-950">
      <PublicHeader transparent tone="light" eventsHref={clubHomeHref} />
      <section className="mx-auto flex max-w-6xl items-center justify-center px-4 py-16 md:px-6 lg:px-8">
      <div className="w-full max-w-lg border-2 border-zinc-950 bg-[#fbf7ec] p-8 text-center shadow-[8px_8px_0_rgba(24,24,27,0.14)]">
        <XCircle className="mx-auto size-12 text-[#b83224]" />
        <h1 className="mt-5 text-4xl font-black uppercase tracking-tight">Betalingen ble avbrutt.</h1>
        <p className="mt-2 font-medium text-zinc-700">Du kan gå tilbake til eventet og prøve igjen.</p>
        <div className="mt-7 flex justify-center gap-2">
          <Button asChild className="rounded-none border-2 border-zinc-950 bg-[#b83224] font-bold text-white hover:bg-[#9f2d21]"><Link href={eventHref}>Tilbake til eventet</Link></Button>
          <Button asChild variant="outline" className="rounded-none border-2 border-zinc-950 bg-transparent font-bold hover:bg-zinc-950 hover:text-white"><Link href={clubHomeHref}>Tilbake til klubben</Link></Button>
        </div>
      </div>
      </section>
    </main>
  )
}