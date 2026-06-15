export const MAX_ARTIST_AVAILABILITY_DATES = 3

export const ARTIST_AVAILABILITY_SHOW_STATUSES = ['booking', 'published', 'fullbooked'] as const

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

export function countActiveAvailabilityDates(
  rows: Array<{ available_date: string }>,
  referenceDate = todayIsoDate(),
) {
  return rows.filter((row) => row.available_date >= referenceDate).length
}

export function canAddAvailabilityDate(
  rows: Array<{ available_date: string }>,
  referenceDate = todayIsoDate(),
) {
  return countActiveAvailabilityDates(rows, referenceDate) < MAX_ARTIST_AVAILABILITY_DATES
}

export function isAvailabilityDateActive(date: string, referenceDate = todayIsoDate()) {
  return date >= referenceDate
}
