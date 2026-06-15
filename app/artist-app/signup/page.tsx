import { redirect } from 'next/navigation'
import { PublicHeader } from '@/components/public/public-header'
import { ArtistSignupForm } from '@/components/artist/artist-signup-form'
import { Footer } from '@/components/Footer'
import { getArtistSignupDraft } from '@/lib/artist-registration-draft'
import { createClient } from '@/lib/supabase/server'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'

export const metadata = { title: 'Registrer artistprofil — humor.events' }

export default async function ArtistSignupPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>
}) {
  const { status, error } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const destination = await getPortalDestinationForAuthUser(user.id)
    if (destination === '/artist-app') {
      redirect('/artist-app')
    }
  }

  const draft = user ? await getArtistSignupDraft(user.id) : null

  return (
    <main className="min-h-svh bg-[#f3ead9]/10 text-zinc-950">
      <section className="relative isolate overflow-hidden border-b-2 border-zinc-950 bg-[#f3ead9] text-zinc-950">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.72' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.45'/></svg>\")",
          }}
        />

        <PublicHeader transparent tone="light" />
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 lg:px-8">
        <ArtistSignupForm
          action="/artist-app/signup/submit"
          draft={draft ?? undefined}
          successMessage={status === 'submitted' ? 'Profilen er sendt til vurdering.' : undefined}
          errorMessage={
            error === 'email_exists'
              ? 'E-postadressen er allerede registrert. Logg inn for å fullføre profilen.'
              : error === 'account_mismatch'
                ? 'E-posten må matche kontoen du er innlogget med.'
                : error === 'invalid_password'
                  ? 'Passordet må være minst 8 tegn.'
                  : error === 'invalid_email'
                    ? 'Ugyldig e-postadresse.'
                    : error === 'invalid_youtube'
                      ? 'Legg inn en gyldig lenke til en YouTube-video.'
                      : error === 'missing' && draft
                        ? 'Fullfør de resterende feltene for å aktivere komikerprofilen din.'
                        : error === 'missing'
                          ? 'Fyll ut alle obligatoriske felt før du sender inn.'
                          : error === 'unconfirmed'
                            ? 'Kontoen er ikke aktiv ennå. Registrer artistprofil på nytt eller kontakt oss.'
                            : error === 'failed'
                              ? 'Kunne ikke opprette profilen. Prøv igjen.'
                              : undefined
          }
        />
      </section>
      <Footer />
    </main>
  )
}
