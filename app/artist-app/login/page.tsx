import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { PublicHeader } from '@/components/public/public-header'
import { LoginForm } from '@/components/login-form'
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
      redirect(next || '/artist-app')
    }
    if (destination) redirect(destination)
  }

  return (
    <main className="min-h-svh bg-[#f3ead9] text-zinc-950">
      <section className="relative isolate overflow-hidden border-b-2 border-zinc-950 bg-[#f3ead9]">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.72' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.45'/></svg>\")",
          }}
        />

        <PublicHeader transparent tone="light" />

        <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 pb-10 pt-8 md:grid-cols-[minmax(0,0.9fr)_400px] md:items-start md:px-6 md:pb-14 md:pt-10 lg:px-8">
          <div>
            <div className="mb-5 inline-flex border border-zinc-950 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em]">
              Portal / humor.events
            </div>
            <h1 className="max-w-[700px] text-[clamp(2.75rem,6.7vw,5.4rem)] font-black uppercase leading-[0.82] tracking-[-0.035em]">
              Logg inn som komiker
            </h1>
            <p className="mt-5 max-w-xl text-sm font-medium text-zinc-700 md:text-base">
              Gå til bookinger, svar på tilbud og hold profilen din oppdatert i samme uttrykk som resten av humor.events.
            </p>
            <div className="mt-8 border-y-2 border-zinc-950 py-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-500">Hva du finner her</p>
              <ul className="mt-3 space-y-2 text-sm font-medium text-zinc-700">
                <li>Kommende show og honorar</li>
                <li>Aktive tilbud som venter på svar</li>
                <li>Profilen arrangørene ser</li>
              </ul>
            </div>
            <Link href="/artist-app/signup" className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold underline decoration-2 underline-offset-4 hover:text-[#b83224]">
              Registrer ny profil <ArrowRight className="size-4" />
            </Link>
          </div>

          <div className="w-full max-w-sm md:justify-self-end">
            <LoginForm
              brandLabel="humor.events"
              title="Komikerportal"
              description="Logg inn med komikerprofil"
              action="/artist-app/login/submit"
              errorMessage={error === 'invalid' ? 'Feil e-post eller passord.' : undefined}
              signupHref="/artist-app/signup"
              nextPath={next}
              theme="poster"
              className="md:rotate-[-1deg]"
            />
          </div>
        </div>
      </section>
    </main>
  )
}