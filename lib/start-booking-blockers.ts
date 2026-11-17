/**
 * Hva som stopper Start booking, regnet av lagrede plasser.
 *
 * Utkast-kortet (`RequirementsTab`) regner det samme av skjemaets egne
 * verdier mens bookeren skriver. Kortet for resten av plassene på et show i
 * booking (`LineupTab`) og serveren (`startBookingAction`) bruker denne, så
 * en plass uten beløp ikke kan startes derfra heller.
 */

export type StartBookingSpot = {
  role_name: string | null
  quantity?: number | null
  compensation_type: string | null
  compensation_amount: number | null
  compensation_percent: number | null
}

/** Prosenten en plass lover bort: satsen ganger antall seter. */
export function percentCommittedBy(spot: Pick<StartBookingSpot, 'compensation_type' | 'compensation_percent' | 'quantity'>) {
  if (spot.compensation_type !== 'percent') return 0
  return Number(spot.compensation_percent ?? 0) * Math.max(1, spot.quantity ?? 1)
}

function count(n: number, one: string, many: string) {
  return `${n} spot${n > 1 ? `s ${many}` : ` ${one}`}`
}

export function startBookingBlockers(spots: StartBookingSpot[], percentLimit: number): string[] {
  const missingRole = spots.filter((spot) => !spot.role_name?.trim()).length
  const missingAmount = spots.filter((spot) =>
    (spot.compensation_type === 'fixed' && spot.compensation_amount == null)
    || (spot.compensation_type === 'percent' && spot.compensation_percent == null),
  ).length
  const percentTotal = spots.reduce((sum, spot) => sum + percentCommittedBy(spot), 0)

  const blockers: string[] = []
  if (spots.length === 0) blockers.push('Add at least one lineup spot')
  if (missingRole > 0) blockers.push(`${count(missingRole, 'is', 'are')} missing a role name`)
  if (missingAmount > 0) blockers.push(`${count(missingAmount, 'is', 'are')} missing an amount or percentage`)
  if (percentTotal > percentLimit + 0.0001) {
    blockers.push(`Percentage allocation is ${Math.round(percentTotal * 10) / 10}% (max ${percentLimit}%)`)
  }
  return blockers
}
