'use server'

import { revalidatePath } from 'next/cache'
import {
  disconnectComedianProfile,
  linkExistingComedianAccount,
  type ComedianLinkErrorCode,
} from '@/lib/comedian-link'
import { getAuthUser, getSessionProfile } from '@/lib/session'

export type ComedianLinkFormState = {
  error?: string
  success?: string
}

const ERROR_MESSAGES: Record<ComedianLinkErrorCode, string> = {
  not_club_login: 'Only club logins can connect a comedian profile.',
  already_has_profile: 'Your login already has a comedian profile.',
  invalid_credentials: 'Wrong email or password for the comedian account.',
  linked_to_other_club_login:
    'That comedian profile is connected to another club login. Disconnect it there first.',
  no_comedian_profile: 'That login has no comedian profile.',
  not_linked: 'Your login has no comedian profile to disconnect.',
  email_required: 'Enter an email for the comedian login.',
  email_invalid: 'Enter a valid email address.',
  email_same_as_login: 'Use a different email than your club login.',
  email_taken: 'That email already has a login. Use another one.',
  conflict: 'The comedian profile changed while you were connecting it. Try again.',
  failed: 'Something went wrong. Try again.',
}

/**
 * Innloggingen som spør. Koblingen gjelder alltid den innloggede brukeren
 * selv — aldri en klubb — så det finnes ingen klubb-ID i skjemaet.
 */
async function currentLogin() {
  const user = await getAuthUser()
  if (!user) return null
  const profile = await getSessionProfile(user.id)
  return { authUserId: user.id, email: profile?.email ?? user.email ?? '', role: profile?.role }
}

export async function linkComedianAction(
  _previous: ComedianLinkFormState,
  formData: FormData
): Promise<ComedianLinkFormState> {
  const current = await currentLogin()
  if (!current) return { error: 'Your session has expired. Sign in again.' }

  const result = await linkExistingComedianAccount(current, {
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  })
  if (!result.ok) return { error: ERROR_MESSAGES[result.code] }

  // Bryteren står i layouten, så hele portalen må tegnes på nytt.
  revalidatePath('/admin-app', 'layout')
  return { success: 'Comedian profile connected.' }
}

export async function disconnectComedianAction(
  _previous: ComedianLinkFormState,
  formData: FormData
): Promise<ComedianLinkFormState> {
  const current = await currentLogin()
  if (!current) return { error: 'Your session has expired. Sign in again.' }

  const result = await disconnectComedianProfile(current, { newEmail: String(formData.get('email') ?? '') })
  if (!result.ok) return { error: ERROR_MESSAGES[result.code] }

  revalidatePath('/admin-app', 'layout')
  if (result.restoredLogin) {
    return { success: `Disconnected. The comedian signs in with ${result.loginEmail ?? 'their own login'} again.` }
  }
  return {
    success: result.emailSent
      ? `Disconnected. We sent a link to ${result.loginEmail} to set a password.`
      : `Disconnected. The comedian login is ${result.loginEmail}; use “Forgot password” in the comedian portal to set a password.`,
  }
}
