import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { getAuthUser, getSessionProfile } from '@/lib/session'
import {
  contactExportCsv,
  exportFileName,
  metaAudienceCsv,
  metaAudienceRows,
  type ExportContact,
} from '@/lib/marketing/contact-export'
import { applyContactFilter, contactSearchTerm, toContactFilter } from '@/lib/marketing/contact-filter'

export const runtime = 'nodejs'

/**
 * Nedlasting av klubbens kontaktliste.
 *
 * - `kind=contacts`: det klubben ser på Marketing-siden (filter og søk), som
 *   CSV for Excel.
 * - `kind=meta`: kundelista til Meta — bare de med aktivt annonsesamtykke,
 *   uansett filter.
 *
 * Hver nedlasting logges i `club_contact_exports` (hvem, når, hva, hvor mange).
 * Lenkene på siden er vanlige `<a download>`, ikke `Link`, så de forhåndshentes
 * aldri — en logget eksport er en ekte nedlasting.
 */

const PAGE = 1000
const COLUMNS =
  'email, name, phone, source, consent_at, consent_text, unsubscribed_at, ads_consent_at, ads_consent_text, ads_withdrawn_at, last_show_id, last_purchase_at'

export async function GET(request: Request) {
  let clubId: string
  try {
    clubId = await getDefaultClubIdForAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(request.url)
  const kind = url.searchParams.get('kind') === 'meta' ? 'meta' : 'contacts'
  const filter = kind === 'meta' ? 'ads' : toContactFilter(url.searchParams.get('status'))
  const term = kind === 'meta' ? '' : contactSearchTerm(url.searchParams.get('q'))

  const db = createAdminClient()
  const { data: club } = await db.from('clubs').select('name, country').eq('id', clubId).maybeSingle()
  if (!club) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // PostgREST gir maks 1000 rader per kall. Sortert på id, så sidene ikke
  // overlapper om noen melder seg på mens vi leser.
  type Row = Omit<ExportContact, 'last_show'> & { last_show_id: string | null }
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await applyContactFilter(
      db.from('club_contacts').select(COLUMNS).eq('club_id', clubId),
      filter,
      term,
    )
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: `Could not read contacts: ${error.message}` }, { status: 500 })
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }

  let csv: string
  let rowCount = rows.length
  if (kind === 'meta') {
    const metaRows = metaAudienceRows(rows, club.country)
    rowCount = metaRows.length
    csv = metaAudienceCsv(metaRows)
  } else {
    const showIds = [...new Set(rows.map((row) => row.last_show_id).filter((id): id is string => Boolean(id)))]
    const shows = new Map<string, { title: string; date: string | null }>()
    for (let index = 0; index < showIds.length; index += 200) {
      const { data } = await db.from('shows').select('id, title, date').in('id', showIds.slice(index, index + 200))
      for (const show of data ?? []) shows.set(show.id, { title: show.title, date: show.date })
    }
    csv = contactExportCsv(
      rows.map((row) => ({ ...row, last_show: row.last_show_id ? (shows.get(row.last_show_id) ?? null) : null })),
    )
  }

  // Uten logg, ingen fil: ansvarligheten er grunnen til at loggen finnes.
  const user = await getAuthUser()
  const profile = user ? await getSessionProfile(user.id) : null
  const { error: logError } = await db.from('club_contact_exports').insert({
    club_id: clubId,
    exported_by: profile?.id ?? null,
    kind,
    filter: kind === 'meta' ? 'ads' : [filter, term && `q=${term}`].filter(Boolean).join(' '),
    row_count: rowCount,
  })
  if (logError) return NextResponse.json({ error: `Could not log the export: ${logError.message}` }, { status: 500 })

  const fileName = exportFileName(club.name, kind)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
