/**
 * Pure date and filter helpers for the public event list.
 *
 * Deliberately kept out of `lib/public-events.ts`, which pulls in the
 * Supabase admin client — this is the part client components need,
 * without the server baggage.
 *
 * All dates are `YYYY-MM-DD` strings, never Date objects across
 * boundaries. `new Date('2026-08-21')` is parsed as UTC midnight, which
 * lands on the wrong day in negative timezones — so we parse per part.
 */

/**
 * Sentinel for "no city filter". Lives here rather than in the grid component
 * so the server action behind the signup form can compare against the same value.
 */
export const ALL_CITIES = 'All'

export type TimeRange = 'all' | 'tonight' | 'this-weekend' | 'this-week' | 'this-month'

export const TIME_RANGES: Array<{ value: TimeRange; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'this-week', label: 'This week' },
  { value: 'this-month', label: 'This month' },
]

/**
 * Today's date in Europe/Oslo as `YYYY-MM-DD`.
 *
 * The server runs UTC on Vercel, the browser runs local time. Without a
 * shared starting point, "Tonight" counts differently on the two sides
 * between midnight and 02:00, and React complains about a hydration
 * mismatch. So this is called on the server and passed down as a prop.
 *
 * The timezone stays Oslo regardless of interface language — the venues
 * are in Norway, so that is where a show date belongs.
 */
export function getOsloToday(now: Date = new Date()): string {
  // 'sv-SE' yields the ISO form YYYY-MM-DD directly.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(now)
}

/** Parses `YYYY-MM-DD` into a local Date at midnight, with no UTC shift. */
export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

/** The other way round: local Date to `YYYY-MM-DD`. */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * Start and end (inclusive) of a time range, as ISO dates.
 * Returns null for 'all'.
 *
 * The week runs Monday–Sunday. "This weekend" is the coming Friday to
 * Sunday — if it is already the weekend, that means this one, not the next.
 */
export function rangeBounds(range: TimeRange, today: string): { from: string; to: string } | null {
  if (range === 'all') return null

  const start = parseIsoDate(today)
  // getDay(): 0 = Sunday. We want 0 = Monday.
  const weekday = (start.getDay() + 6) % 7

  switch (range) {
    case 'tonight':
      return { from: today, to: today }

    case 'this-weekend': {
      // Friday = 4. Past Friday means the weekend is already under way.
      const daysToFriday = weekday <= 4 ? 4 - weekday : 0
      const friday = addDays(start, daysToFriday)
      const sunday = addDays(start, 6 - weekday)
      return { from: toIsoDate(friday > start ? friday : start), to: toIsoDate(sunday) }
    }

    case 'this-week':
      return { from: today, to: toIsoDate(addDays(start, 6 - weekday)) }

    case 'this-month': {
      const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0)
      return { from: today, to: toIsoDate(lastDay) }
    }
  }
}

export function isInRange(showDate: string, range: TimeRange, today: string): boolean {
  const bounds = rangeBounds(range, today)
  if (!bounds) return true
  const date = showDate.slice(0, 10)
  return date >= bounds.from && date <= bounds.to
}

/**
 * "Today", "Tomorrow", otherwise "Wed 21 Aug" — used on the card's first
 * line, where date and time sit together.
 */
export function formatDayLabel(showDate: string, today: string): string {
  const date = showDate.slice(0, 10)
  if (date === today) return 'Today'
  if (date === toIsoDate(addDays(parseIsoDate(today), 1))) return 'Tomorrow'

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(parseIsoDate(date))
}
