import { PublicHeader } from '@/components/public/public-header'
import { ArtistSignupForm } from '@/components/artist/artist-signup-form'
import { Footer } from '@/components/Footer'

export const metadata = { title: 'Register Artist Profile — Tickethalo' }

export default async function ArtistSignupPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>
}) {
  const { error } = await searchParams

  return (
    <main
      className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-20 pt-28 md:px-8">
        <header className="pb-5">
          <p className="text-[13px] text-[var(--ev-faint)]">Comedian Portal</p>
          <h1 className="mt-2 text-balance text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
            Register comedian profile
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--ev-muted)]">
            Create your comedian profile, video and contact info, and start using the artist portal right away.
          </p>
        </header>

        <div className="">
          <ArtistSignupForm
            action="/artist-app/signup/submit"
            errorMessage={
              error === 'email_exists'
                ? 'This email address is already registered. Try logging in.'
                : error === 'invalid_password'
                  ? 'Password must be at least 8 characters.'
                  : error === 'password_mismatch'
                    ? 'Passwords do not match.'
                  : error === 'invalid_email'
                    ? 'Invalid email address.'
                      : error === 'invalid_video'
                        ? 'Enter a valid video link.'
                      : error === 'missing'
                        ? 'Fill in all required fields before submitting.'
                        : error === 'unconfirmed'
                          ? 'The account is not active yet. Register again or contact us.'
                          : error === 'failed'
                            ? 'Could not create the profile. Try again.'
                            : undefined
            }
          />
        </div>
      </div>

      <Footer />
    </main>
  )
}
