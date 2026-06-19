import { SignupForm } from "@/components/signup-form"
import { PublicHeader } from "@/components/public/public-header"

export const metadata = { title: 'Lag komikerprofil — humor.events' }

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>
}) {
  const { status, error } = await searchParams

  return (
    <main className="public-shell min-h-svh bg-vipps-offwhite text-foreground">
      <PublicHeader transparent tone="light" />
      <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-10 md:grid-cols-[0.8fr_1fr] md:px-6 lg:px-8">
        <div className="md:pt-10">
          <div className="mb-5 inline-flex rounded-full bg-vipps-orange-0 px-3.5 py-1.5 text-xs font-semibold text-vipps-orange-80">Artistprofil</div>
          <h1 className="text-[clamp(2.5rem,6vw,4.5rem)] font-semibold leading-[0.95] tracking-tight">Bli en del av lineupen</h1>
          <p className="mt-5 max-w-md text-base text-muted-foreground">Send inn profil, sceneerfaring og lenker. Booking-teamet vurderer nye profiler fortløpende.</p>
        </div>
        <div className="rounded-2xl bg-card p-6 shadow-lg ring-1 ring-vipps-orange/10 md:p-8">
          <SignupForm
            successMessage={status === 'submitted' ? 'Profilen er sendt til vurdering.' : undefined}
            errorMessage={
              error === 'email_exists'
                ? 'E-postadressen er allerede registrert. Prøv å logge inn.'
                : error === 'invalid_password'
                  ? 'Passordet må være minst 8 tegn.'
                  : error === 'invalid_email'
                    ? 'Ugyldig e-postadresse.'
                    : error === 'unconfirmed'
                      ? 'Kontoen er ikke aktiv ennå. Registrer artistprofil på nytt eller kontakt oss.'
                      : error === 'failed'
                        ? 'Kunne ikke opprette profilen. Prøv igjen.'
                        : undefined
            }
          />
        </div>
      </section>
    </main>
  )
}
