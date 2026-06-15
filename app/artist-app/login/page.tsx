import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { PublicHeader } from '@/components/public/public-header'
import { LoginForm } from '@/components/login-form'
import { Footer } from '@/components/Footer'
import { createClient } from '@/lib/supabase/server'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'

export default async function ArtistLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const { error, next } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const destination = await getPortalDestinationForAuthUser(user.id)
    if (destination?.startsWith('/artist-app')) {
      redirect(next || destination)
    }
    if (destination) redirect(destination)
  }

  return (
    <main className="min-h-screen bg-white text-black">
      <section className="border-b border-black/10 min-h-[calc(100vh-100px)]">
        <PublicHeader transparent tone="light" />

        <div className="mx-auto grid w-full max-w-6xl items-center justify-center mt-5vh md:mt-[15vh] gap-8 px-4 pb-10 pt-8 md:grid-cols-[minmax(0,0.95fr)_320px] md:items-start md:gap-14 md:px-6 md:pb-14 md:pt-10 lg:px-8">
          <div>
            <div className="mb-5 inline-flex border border-black px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em]">
              Tilbud og bookinger
            </div>
            <h1 className="max-w-[760px] text-[clamp(2.75rem,6.6vw,5.4rem)] font-medium leading-[0.9] tracking-tight">
              Komikerportal
            </h1>
            <p className="mt-4 max-w-xl text-sm text-zinc-600 md:text-base">
              Logg inn for å se bookinger, svare på tilbud og holde profilen din oppdatert.
            </p>

            <div className="mt-8 border-y border-black/10 py-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-500">Hva du finner her</p>
              <ul className="mt-3 space-y-2 text-sm text-zinc-600">
                <li>Kommende show og honorar</li>
                <li>Aktive tilbud som venter på svar</li>
                <li>Profilen bookingteamet ser</li>
              </ul>
            </div>

            <Link
              href="/artist-app/signup"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 hover:text-[#ff6bff]"
            >
              Registrer ny profil <ArrowRight className="size-4" />
            </Link>
          </div>

          <div className="relative mx-auto w-full max-w-[320px] md:max-w-none">
            <LoginForm
              brandLabel="humor.events"
              title="Logg inn"
              description="Bruk e-post og passord knyttet til komikerprofilen din"
              action="/artist-app/login/submit"
              errorMessage={error === 'invalid' ? 'Feil e-post eller passord.' : undefined}
              signupHref="/artist-app/signup"
              nextPath={next}
              theme="artist"
            />
          </div>
        </div>

        <div className="overflow-hidden border-t border-black/10 bg-[#ff6bff]">
          <div
            className="flex items-center py-3 text-[10px] font-black uppercase tracking-[0.34em] text-black will-change-transform"
            style={{ animation: 'marquee 42s linear infinite' }}
          >
            {[0, 1].map((i) => (
              <span key={i} className="flex shrink-0 items-center gap-8 pr-8" aria-hidden={i > 0}>
                <span>Komikerportal</span><span>·</span>
                <span>Tilbud</span><span>·</span>
                <span>Bookinger</span><span>·</span>
                <span>Profil</span><span>·</span>
                <span>humor.events</span><span>·</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
