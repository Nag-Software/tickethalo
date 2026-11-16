import type { RequirementCompensationType, RequirementEnergy, RequirementGender } from '@/types/database'
import { STANDARD_SPOT_TYPES, activeSpotTypes, type ClubSpotType } from '@/lib/spot-types'

/**
 * The lineup a blank show starts with.
 *
 * One seat per spot type the club uses, in the club's order (migration 100,
 * My Club → Spot types). A club that has not changed anything gets Tom's
 * standard bill: Host / MC, Opener / Bullet, Middle / Feature, Showcase Spot,
 * Open Spot and Closer / Headliner — the Opener is only ever the first act.
 * They are plain requirements: rename, re-fee, reorder or delete them from
 * the Lineup tab.
 *
 * Every seat sits on `percent`. A type without a default fee gets 0, which is
 * the fee model's way of saying «no fee» — leaving the type unset would block
 * Start booking.
 */

export type DefaultLineupSpot = {
  role_name: string
  quantity: number
  lineup_position: number
  energy_level: RequirementEnergy
  required_gender: RequirementGender
  compensation_type: RequirementCompensationType
  compensation_amount: number | null
  compensation_percent: number
}

type LineupType = Pick<ClubSpotType, 'name' | 'position' | 'active' | 'default_compensation_percent'>

const STANDARD_TYPES: LineupType[] = STANDARD_SPOT_TYPES.map((type) => ({ ...type, active: true }))

/** One row per seat, so each can be tuned on its own. */
export function defaultLineupSpots(types: readonly LineupType[] = STANDARD_TYPES): DefaultLineupSpot[] {
  const active = activeSpotTypes(types)
  return (active.length > 0 ? active : activeSpotTypes(STANDARD_TYPES)).map((type, index) => ({
    role_name: type.name,
    quantity: 1,
    lineup_position: index + 1,
    energy_level: 'any' as RequirementEnergy,
    required_gender: 'any' as RequirementGender,
    compensation_type: 'percent' as RequirementCompensationType,
    compensation_amount: null,
    compensation_percent: Number(type.default_compensation_percent ?? 0),
  }))
}
