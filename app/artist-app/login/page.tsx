import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'
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
    <main
      className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      <section className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 px-4 pb-16 pt-28 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-16">
        <div>
          <p className="text-[13px] text-[var(--ev-faint)]">Komikerportal</p>
          <h1 className="mt-2 text-balance text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
            Logg inn som komiker
          </h1>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-[var(--ev-muted)]">
            Gå til bookingene dine, svar på tilbud og hold profilen oppdatert.
          </p>

          <ul className="mt-8 flex flex-col divide-y divide-[var(--ev-line)] border-y border-[var(--ev-line)]">
            {['Kommende show og honorar', 'Aktive tilbud som venter på svar', 'Profilen arrangørene ser'].map((item) => (
              <li key={item} className="py-3 text-[15px] font-medium">{item}</li>
            ))}
          </ul>

          <Link
            href="/artist-app/signup"
            className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--ev-accent)] underline underline-offset-4"
          >
            Registrer ny profil <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="w-full lg:justify-self-end">
          <LoginForm
            brandLabel="humor.events"
            title="Komikerportal"
            description="Logg inn med komikerprofil"
            action="/artist-app/login/submit"
            errorMessage={error === 'invalid' ? 'Feil e-post eller passord.' : undefined}
            signupHref="/artist-app/signup"
            nextPath={next}
            theme="portal"
          />
        </div>
      </section>

      <Footer />
    </main>
  )
}
