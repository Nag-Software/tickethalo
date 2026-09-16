import Link from 'next/link'
import { Footer } from '@/components/Footer'
import { PublicHeader } from '@/components/public/public-header'
import { ForgotPasswordForm } from '@/components/forgot-password-form'

export default async function ArtistForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams

  return (
    <main className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]" data-tone="light">
      <PublicHeader tone="light" />
      <section className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24">
        <ForgotPasswordForm callbackPath="/artist-app/auth/callback" resetPath="/artist-app/reset-password" loginPath="/artist-app/login" />
        {error === 'callback' && <p className="text-center text-[13px] text-[var(--ev-accent)]">That reset link is invalid or expired. Request a new one.</p>}
        <Link href="/artist-app/login" className="text-[13px] text-[var(--ev-muted)] underline underline-offset-4">Back to sign in</Link>
      </section>
      <Footer />
    </main>
  )
}