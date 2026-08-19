import { SignupForm } from "@/components/signup-form"
import { PublicHeader } from "@/components/public/public-header"

export const metadata = { title: 'Lag komikerprofil — Tickethalo' }

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>
}) {
  const { status, error } = await searchParams

  return (
    <main className="min-h-svh bg-[#f3ead9] text-zinc-950">
      <PublicHeader transparent tone="light" />
      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-[0.8fr_1fr] md:px-6 lg:px-8">
        <div className="md:pt-10">
          <div className="mb-5 inline-flex border border-zinc-950 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em]">Artistprofil</div>
          <h1 className="text-[clamp(3rem,7vw,6rem)] font-black uppercase leading-[0.82] tracking-[-0.04em]">Bli en del av lineupen</h1>
          <p className="mt-5 max-w-md text-base font-medium text-zinc-700">Send inn profil, sceneerfaring og lenker. Booking-teamet vurderer nye profiler fortløpende.</p>
        </div>
        <div className="border-2 border-zinc-950 bg-[#fbf7ec] p-5 shadow-[8px_8px_0_rgba(24,24,27,0.14)]">
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
