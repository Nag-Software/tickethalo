import { PublicHeader } from '@/components/public/public-header'
import { ArtistSignupForm } from '@/components/artist/artist-signup-form'
import { Footer } from '@/components/Footer'

export const metadata = { title: 'Registrer artistprofil — Tickethalo' }

export default async function ArtistSignupPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>
}) {
  const { status, error } = await searchParams

  return (
    <main
      className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-20 pt-28 md:px-8">
        <header className="border-b border-[var(--ev-line)] pb-7">
          <p className="text-[13px] text-[var(--ev-faint)]">Komikerportal</p>
          <h1 className="mt-2 text-balance text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
            Registrer komikerprofil
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--ev-muted)]">
            Send inn profil, video og kontaktinfo, så vurderer bookingteamet deg til kommende kvelder.
          </p>
        </header>

        <div className="pt-8">
          <ArtistSignupForm
            action="/artist-app/signup/submit"
            successMessage={status === 'submitted' ? 'Profilen er sendt til vurdering.' : undefined}
            errorMessage={
              error === 'email_exists'
                ? 'E-postadressen er allerede registrert. Prøv å logge inn.'
                : error === 'invalid_password'
                  ? 'Passordet må være minst 8 tegn.'
                  : error === 'invalid_email'
                    ? 'Ugyldig e-postadresse.'
                    : error === 'invalid_youtube'
                      ? 'Legg inn en gyldig lenke til en YouTube-video.'
                      : error === 'missing'
                        ? 'Fyll ut alle obligatoriske felt før du sender inn.'
                        : error === 'unconfirmed'
                          ? 'Kontoen er ikke aktiv ennå. Registrer komikerprofil på nytt eller kontakt oss.'
                          : error === 'failed'
                            ? 'Kunne ikke opprette profilen. Prøv igjen.'
                            : undefined
            }
          />
        </div>
      </div>

      <Footer />
    </main>
  )
}
