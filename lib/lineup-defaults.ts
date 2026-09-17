import type { RequirementCompensationType, RequirementEnergy, RequirementGender } from '@/types/database'

/**
 * The lineup a blank show starts with.
 *
 * A new event is almost always the club's standard bill — one headliner, one
 * host, three stand-up spots and an open mic — so the booker gets those rows
 * already laid out instead of building them by hand every time. They are plain
 * requirements: rename, re-fee, reorder or delete them from the Lineup tab.
 *
 * Open Mic sits on `percent` with 0, which is the fee model's way of saying
 * «no fee» — leaving the type unset would block Start booking.
 */
const STANDARD_LINEUP: Array<{ roleName: string; count: number; percent: number }> = [
  { roleName: 'Headliner', count: 1, percent: 15 },
  { roleName: 'Host', count: 1, percent: 15 },
  { roleName: 'Stand-up', count: 3, percent: 10 },
  { roleName: 'Open Mic', count: 1, percent: 0 },
]

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

/**
 * One row per seat — three stand-up spots are three requirements, the way the
 * Lineup tab draws them, so each can be tuned on its own.
 */
export function defaultLineupSpots(): DefaultLineupSpot[] {
  let position = 0

  return STANDARD_LINEUP.flatMap((spot) =>
    Array.from({ length: spot.count }, () => {
      position += 1

      return {
        role_name: spot.roleName,
        quantity: 1,
        lineup_position: position,
        energy_level: 'any' as RequirementEnergy,
        required_gender: 'any' as RequirementGender,
        compensation_type: 'percent' as RequirementCompensationType,
        compensation_amount: null,
        compensation_percent: spot.percent,
      }
    })
  )
}
