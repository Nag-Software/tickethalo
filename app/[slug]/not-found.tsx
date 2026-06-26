import Link from 'next/link'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'

// Covers the club landing page and the event-detail page below it.
export default function NotFound() {
  return (
    <main className="public-shell min-h-screen bg-background text-foreground">
      <PublicHeader transparent tone="light" />
      <section className="mx-auto flex max-w-3xl flex-col items-center justify-center gap-6 px-4 py-32 text-center">
        <p className="text-sm font-bold uppercase tracking-[0.22em] text-zinc-500">404</p>
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">Fant ikke siden</h1>
        <p className="max-w-md text-sm text-zinc-500">
          Klubben eller arrangementet finnes ikke, eller er ikke publisert lenger.
        </p>
        <Link
          href="/"
          className="rounded-xl bg-vipps-orange px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-vipps-orange-60"
        >
          Til forsiden
        </Link>
      </section>
      <Footer />
    </main>
  )
}
