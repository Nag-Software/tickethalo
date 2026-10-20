/**
 * Siden en innlogging med både klubb og komiker sist brukte. Egen fil fordi
 * klientkomponenten som setter cookien ikke kan importere `lib/portal-auth`
 * (den drar med seg Supabase-klientene på serveren).
 */
export type PortalSide = 'club' | 'artist'

export const LAST_PORTAL_COOKIE = 'th_last_portal'

export function parsePortalSide(value: string | null | undefined): PortalSide | undefined {
  return value === 'club' || value === 'artist' ? value : undefined
}
