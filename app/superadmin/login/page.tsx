import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginForm } from '@/components/login-form'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'

export default async function SuperadminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const destination = await getPortalDestinationForAuthUser(user.id)
    if (destination) redirect(destination)
  }

  const errorMessage =
    error === 'unauthorized'
      ? 'This account belongs to a different panel.'
      : error === 'invalid'
        ? 'Wrong email or password.'
        : undefined

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm
          title="Tickethalo"
          description="Superadmin sign-in"
          action="/superadmin/login/submit"
          errorMessage={errorMessage}
          showSignupLink={false}
        />
      </div>
    </div>
  )
}
