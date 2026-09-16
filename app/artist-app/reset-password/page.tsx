import { redirect } from 'next/navigation'
import { Footer } from '@/components/Footer'
import { PublicHeader } from '@/components/public/public-header'
import { ResetPasswordForm } from '@/components/reset-password-form'
import { createClient } from '@/lib/supabase/server'

export default async function ArtistResetPasswordPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/artist-app/forgot-password')

  return (
    <main className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]" data-tone="light">
      <PublicHeader tone="light" />
      <section className="flex flex-1 items-center justify-center px-4 py-24"><ResetPasswordForm loginPath="/artist-app/login" /></section>
      <Footer />
    </main>
  )
}