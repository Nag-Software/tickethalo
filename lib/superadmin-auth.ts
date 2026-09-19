import { getAuthUser, getSessionProfile } from '@/lib/session'

/**
 * Bare superadmin.
 *
 * Layouten over `/superadmin` sjekker det samme, men en server action er et
 * kallbart endepunkt: den kan treffes uten å ha vært innom siden. Handlingene
 * under `/superadmin` sletter klubber, gir folk admin-tilgang og suspenderer
 * komikere med service-nøkkelen, så hver av dem må spørre selv.
 */
export async function assertSuperadmin() {
  const user = await getAuthUser()
  if (!user) throw new Error('Ikke innlogget.')

  const profile = await getSessionProfile(user.id)
  if (!profile || profile.role !== 'superadmin') {
    throw new Error('Bare superadmin har tilgang til dette.')
  }

  return profile
}
