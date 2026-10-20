'use client'

import { useEffect } from 'react'
import { LAST_PORTAL_COOKIE, type PortalSide } from '@/lib/portal-side'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/**
 * Husker hvilken side en innlogging med både klubb og komiker sist brukte,
 * så innloggingen lander der neste gang.
 *
 * Settes i nettleseren når portalen faktisk vises, ikke i proxyen: bryteren
 * er en `<Link>`, og prefetchen av den andre portalen ville ellers satt
 * cookien til siden brukeren ikke er på. Cookien er bare en preferanse —
 * tilgangen avgjøres alltid av `getPortalAccessForAuthUser`.
 */
export function RememberPortal({ side }: { side: PortalSide }) {
  useEffect(() => {
    document.cookie = `${LAST_PORTAL_COOKIE}=${side}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
  }, [side])

  return null
}
