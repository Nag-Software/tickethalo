'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { normalizeArtistRole } from '@/lib/artist-roles'
import { getClubSpotTypes } from '@/lib/spot-types-data'
import { MAX_SPOT_TYPE_NAME } from '@/lib/spot-types'

/**
 * Klubbens spot-typer under My Club (migrasjon 100).
 *
 * Standardtypene kan skrus av og på og flyttes, men ikke døpes om — da kan de
 * sammenlignes på tvers av klubbene. Egne typer får navnet sitt når de lages,
 * og skrus av i stedet for å slettes: navnet står på plasser og på komikerne
 * klubben har merket med typen, og show som er i gang, skal ikke miste det.
 *
 * Alle handlingene sjekker at typen hører til klubben som er valgt.
 */

type Result = { ok: true } | { ok: false; error: string }

async function clubTypes() {
  const clubId = await getDefaultClubIdForAdmin()
  const db = createAdminClient()
  const types = await getClubSpotTypes(db, clubId)
  return { clubId, db, types }
}

function percentFrom(value: unknown): number | null | 'invalid' {
  if (value == null || String(value).trim() === '') return null
  const number = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(number) || number < 0 || number > 100) return 'invalid'
  return Math.round(number * 100) / 100
}

function done(): Result {
  revalidatePath('/admin-app/my-club')
  return { ok: true }
}

export async function updateSpotTypeAction(input: {
  id: string
  active?: boolean
  is_unpaid?: boolean
  default_compensation_percent?: string | number | null
}): Promise<Result> {
  const { db, types } = await clubTypes()
  const type = types.find((row) => row.id === input.id)
  if (!type) return { ok: false, error: 'That spot type is not in your club.' }

  // Uten noen type i bruk ville et nytt show falt tilbake til hele standardlista.
  if (input.active === false && type.active && types.filter((row) => row.active).length <= 1) {
    return { ok: false, error: 'Keep at least one spot type in use.' }
  }

  const patch: { active?: boolean; is_unpaid?: boolean; default_compensation_percent?: number | null } = {}
  if (input.active !== undefined) patch.active = Boolean(input.active)
  if (input.is_unpaid !== undefined) patch.is_unpaid = Boolean(input.is_unpaid)
  if (input.default_compensation_percent !== undefined) {
    const percent = percentFrom(input.default_compensation_percent)
    if (percent === 'invalid') return { ok: false, error: 'The default fee must be a percentage from 0 to 100.' }
    patch.default_compensation_percent = percent
  }
  if (Object.keys(patch).length === 0) return { ok: true }

  const { error } = await db.from('club_spot_types').update(patch).eq('id', type.id).eq('club_id', type.club_id)
  if (error) return { ok: false, error: 'Could not save the spot type. Try again.' }
  return done()
}

export async function addSpotTypeAction(input: {
  name: string
  is_unpaid?: boolean
  default_compensation_percent?: string | number | null
}): Promise<Result> {
  const { clubId, db, types } = await clubTypes()
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ')
  if (!name) return { ok: false, error: 'Give the spot type a name.' }
  if (name.length > MAX_SPOT_TYPE_NAME) return { ok: false, error: `Keep the name under ${MAX_SPOT_TYPE_NAME} characters.` }
  // Rollene lagres som en liste der disse tegnene skiller to roller. «Host /
  // Guest» ville matchet alle Host-plassene, og «Late, Night» aldri noen.
  if (/[\/,;|]/.test(name)) return { ok: false, error: 'Use letters and spaces only — no / , ; or |.' }
  // Et navn som allerede betyr en standardtype («Host», «Open Mic»), ville
  // blitt lest som den — og matchet andre komikere enn klubben tror.
  if (normalizeArtistRole(name)) {
    return { ok: false, error: 'That name is one of the standard spot types. Switch it on in the list instead.' }
  }
  if (types.some((type) => type.name.trim().toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: 'Your club already has a spot type with that name.' }
  }
  const percent = percentFrom(input.default_compensation_percent)
  if (percent === 'invalid') return { ok: false, error: 'The default fee must be a percentage from 0 to 100.' }

  const position = types.reduce((max, type) => Math.max(max, type.position), 0) + 1
  const { error } = await db.from('club_spot_types').insert({
    club_id: clubId,
    standard_key: null,
    name,
    position,
    is_unpaid: Boolean(input.is_unpaid),
    default_compensation_percent: percent,
  })
  if (error?.code === '23505') return { ok: false, error: 'Your club already has a spot type with that name.' }
  if (error) return { ok: false, error: 'Could not add the spot type. Try again.' }
  return done()
}

/** Flytter typen ett hakk opp eller ned. Rekkefølgen er også rekkefølgen på et nytt shows lineup. */
export async function moveSpotTypeAction(input: { id: string; direction: 'up' | 'down' }): Promise<Result> {
  const { db, types } = await clubTypes()
  const ordered = [...types].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name))
  const index = ordered.findIndex((type) => type.id === input.id)
  if (index < 0) return { ok: false, error: 'That spot type is not in your club.' }
  const target = input.direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= ordered.length) return { ok: true }

  const next = [...ordered]
  ;[next[index], next[target]] = [next[target], next[index]]
  // Skriver hele rekkefølgen 1..n: like posisjoner fra før blir da ryddet.
  const results = await Promise.all(
    next.map((type, position) =>
      db.from('club_spot_types').update({ position: position + 1 }).eq('id', type.id).eq('club_id', type.club_id),
    ),
  )
  if (results.some((result) => result.error)) return { ok: false, error: 'Could not move the spot type. Try again.' }
  return done()
}
