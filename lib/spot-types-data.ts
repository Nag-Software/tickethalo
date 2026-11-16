import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeArtistRole } from '@/lib/artist-roles'
import { STANDARD_SPOT_TYPES, type ClubSpotType } from '@/lib/spot-types'

type Db = ReturnType<typeof createAdminClient>

/**
 * Klubbens spot-typer fra databasen (migrasjon 100).
 *
 * En klubb uten typer får standardlista første gang den leses — nye klubber
 * trenger da ikke et eget steg når de opprettes, og ingen klubb står uten.
 */
export async function getClubSpotTypes(db: Db, clubId: string | null | undefined): Promise<ClubSpotType[]> {
  if (!clubId) return []

  const rows = await readTypes(db, clubId)
  if (rows.length > 0) return rows

  const { error } = await db.from('club_spot_types').insert(
    STANDARD_SPOT_TYPES.map((type) => ({ club_id: clubId, ...type })),
  )
  // To sider som åpnes samtidig, kan begge prøve. Den ene vinner, og den
  // andre leser det den første la inn.
  if (error && error.code !== '23505') throw new Error(error.message)
  return readTypes(db, clubId)
}

async function readTypes(db: Db, clubId: string): Promise<ClubSpotType[]> {
  const { data, error } = await db
    .from('club_spot_types')
    .select('id, club_id, standard_key, name, position, active, is_unpaid, default_compensation_percent')
    .eq('club_id', clubId)
    .order('position')
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map(toSpotType)
}

function toSpotType(row: Record<string, unknown>): ClubSpotType {
  const percent = row.default_compensation_percent
  return {
    id: String(row.id),
    club_id: String(row.club_id),
    standard_key: normalizeArtistRole(row.standard_key as string | null) && row.standard_key
      ? (row.standard_key as ClubSpotType['standard_key'])
      : null,
    name: String(row.name ?? ''),
    position: Number(row.position ?? 0),
    active: Boolean(row.active),
    is_unpaid: Boolean(row.is_unpaid),
    // numeric kommer som tekst fra PostgREST.
    default_compensation_percent: percent == null ? null : Number(percent),
  }
}
