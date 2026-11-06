import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser, getSessionProfile, type SessionProfile } from '@/lib/session'
import { getClubAccess } from '@/lib/club-auth'
import { showVenue } from '@/lib/show-venue'

/**
 * Felles for `/api/scanner/*`, som iOS-scanneren snakker med.
 *
 * Appen logger inn mot Supabase selv og sender tokenet som Bearer — se
 * `getAuthUser`. Herfra gjelder de samme reglene som i admin-portalen: bare
 * klubbroller slipper inn, og showene er avgrenset til den valgte klubben.
 */

const CLUB_ROLES = new Set(['superadmin', 'owner', 'admin', 'staff'])

export class ScannerApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function requireScannerUser(): Promise<SessionProfile> {
  const user = await getAuthUser()
  if (!user) throw new ScannerApiError(401, 'Not signed in.')

  const profile = await getSessionProfile(user.id)
  if (!profile || !CLUB_ROLES.has(profile.role)) {
    throw new ScannerApiError(403, 'This account does not have access to the club portal.')
  }

  return profile
}

/** Kjører en handler og gjør feil om til JSON med riktig statuskode. */
export async function scannerRoute(handler: () => Promise<unknown>) {
  try {
    await requireScannerUser()
    return NextResponse.json(await handler(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ScannerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    // `assertShowAccess` kaster vanlige feil når showet ikke hører til klubben.
    const message = error instanceof Error ? error.message : 'Something went wrong.'
    const status = /tilgang|access|Mangler/i.test(message) ? 403 : 500
    if (status === 500) console.error('[scanner-api]', error)
    return NextResponse.json({ error: message }, { status })
  }
}

export type ScannerShow = {
  id: string
  title: string
  date: string | null
  time: string | null
  venue: string | null
  status: string
}

/** Samme utvalg som showlista i webscanneren. */
export async function getScannerShows(): Promise<ScannerShow[]> {
  const access = await getClubAccess()
  if (access.clubIds.length === 0) return []

  const { data: shows } = await createAdminClient()
    .from('shows')
    .select('id, title, date, start_time, venue_name, venue_address, status')
    .in('status', ['published', 'fullbooked', 'completed', 'booking'])
    .in('club_id', access.clubIds)
    .is('deleted_at', null)
    .order('date', { ascending: false })
    .limit(50)

  return (shows ?? []).map((show) => toScannerShow(show))
}

export function toScannerShow(show: {
  id: string
  title: string
  date: string | null
  start_time?: string | null
  venue_name?: string | null
  venue_address?: string | null
  status: string
}): ScannerShow {
  return {
    id: show.id,
    title: show.title,
    date: show.date,
    time: show.start_time ?? null,
    venue: showVenue(show).venue,
    status: show.status,
  }
}
