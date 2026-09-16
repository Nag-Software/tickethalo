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
  searchParams: Promise<{ error?: string; next?: string; reset?: string }>
}) {
  const { error, next, reset } = await searchParams
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

      <section className="mx-auto grid w-full max-w-4xl flex-1 items-center gap-10 px-4 pb-16 pt-28 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-16">
        <div>
          <p className="text-[13px] text-[var(--ev-accent-fill)] font-medium">SIGN IN</p>
          <h1 className="mt-2 text-balance text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
            Get better gigs
          </h1>

          <ul className="mt-8 flex flex-col">
            {['Register a profile', 'Get noticed by bookers', 'Recieve offers for paid gigs'].map((item, index) => (
              <li key={item} className="py-3 text-[15px] font-medium flex flex-row items-center gap-2">
                <div className="size-6 rounded-full bg-[var(--ev-accent-fill)] text-[var(--ev-accent-ink)] pt-[0.5px] flex items-center justify-center">{index + 1}</div>{item}
              </li>
            ))}
          </ul>

          <Link
            href="/artist-app/signup"
            className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--ev-accent)] underline underline-offset-4"
          >
            Register new profile <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="w-full lg:justify-self-end">
          <LoginForm
            brandLabel="Tickethalo"
            title="Comedian portal"
            description="Sign in with your comedian profile"
            action="/artist-app/login/submit"
            errorMessage={
              error === 'invalid'
                ? 'Invalid email or password.'
                : error === 'signup_login'
                  ? 'Your profile was created, but automatic sign-in failed. Please sign in.'
                  : undefined
            }
            successMessage={reset === 'success' ? 'Your password has been updated. You can sign in now.' : undefined}
            forgotPasswordHref="/artist-app/forgot-password"
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
