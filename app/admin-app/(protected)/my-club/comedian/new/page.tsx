import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { AdminHeader } from '@/components/admin/admin-header'
import { ArtistSignupForm } from '@/components/artist/artist-signup-form'
import { getPortalAccessForAuthUser } from '@/lib/portal-auth'
import { getAuthUser, getSessionProfile } from '@/lib/session'

export const metadata = { title: 'Create comedian profile — Tickethalo' }

const ERROR_MESSAGES: Record<string, string> = {
  invalid_email: 'Enter a valid email address for booking offers.',
  invalid_video: 'Enter a valid video link.',
  photo_unchecked: 'Choose your headshot again so we can check it.',
  missing: 'Fill in all required fields before submitting.',
  not_club_login: 'Only club logins can create a comedian profile here.',
  failed: 'Could not create the profile. Try again.',
}

export default async function NewComedianProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const user = await getAuthUser()
  if (!user) redirect('/admin-app/login')

  const [profile, access] = await Promise.all([getSessionProfile(user.id), getPortalAccessForAuthUser(user.id)])
  if (access.comedian) redirect('/artist-app')
  if (!access.club) redirect('/admin-app/my-club')

  return (
    <div>
      <AdminHeader
        title="Create comedian profile"
        description="Perform yourself? Get offers and switch between club and comedian."
        actions={
          <Link
            href="/admin-app/my-club"
            className="inline-flex items-center gap-1 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            My club
          </Link>
        }
      />

      <div className="px-4 py-8 md:px-6 md:py-10">
        <ArtistSignupForm
          action="/admin-app/my-club/comedian/submit"
          existingAccount={{ email: profile?.email ?? user.email ?? '' }}
          errorMessage={error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.failed) : undefined}
        />
      </div>
    </div>
  )
}
