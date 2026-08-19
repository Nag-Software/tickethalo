import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginForm } from '@/components/login-form'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const adminPrefix = '/admin-app'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const destination = await getPortalDestinationForAuthUser(user.id)
    if (destination === adminPrefix || destination === '/superadmin') redirect(adminPrefix)
    if (destination) redirect(destination)
  }

  const errorMessage = error === 'unauthorized'
    ? 'Denne kontoen hører til et annet panel.'
    : error === 'invalid'
      ? 'Feil e-post eller passord.'
      : undefined

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm
          title="Tickethalo"
          description="Logg inn med admin-konto"
          action={`${adminPrefix}/login/submit`}
          errorMessage={errorMessage}
          showSignupLink={false}
        />
      </div>
    </div>
  )
}
