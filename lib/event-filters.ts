/**
 * Rene dato- og filterhjelpere for den offentlige eventlisten.
 *
 * Ligger med vilje utenfor `lib/public-events.ts`, som drar inn
 * Supabase-admin-klienten — dette er de bitene klientkomponentene
 * trenger, uten servertilbehør.
 *
 * Alle datoer er `YYYY-MM-DD`-strenger, aldri Date-objekter over
 * grenser. `new Date('2026-08-21')` tolkes som UTC-midnatt, som gir
 * feil dag i negative tidssoner — derfor parser vi komponentvis.
 */

export type TimeRange = 'alle' | 'i-kveld' | 'i-helga' | 'denne-uka' | 'denne-maneden'

export const TIME_RANGES: Array<{ value: TimeRange; label: string }> = [
  { value: 'alle', label: 'Alle' },
  { value: 'i-kveld', label: 'I kveld' },
  { value: 'i-helga', label: 'I helga' },
  { value: 'denne-uka', label: 'Denne uka' },
  { value: 'denne-maneden', label: 'Denne måneden' },
]

/**
 * Dagens dato i Europe/Oslo som `YYYY-MM-DD`.
 *
 * Serveren kjører UTC på Vercel, nettleseren kjører norsk tid. Uten et
 * felles utgangspunkt teller «I kveld» ulikt på de to sidene mellom
 * midnatt og 02:00, og React klager på hydreringsavvik. Derfor kalles
 * denne på serveren og sendes ned som prop.
 */
export function getOsloToday(now: Date = new Date()): string {
  // 'sv-SE' gir ISO-formen YYYY-MM-DD direkte.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(now)
}

/** Parser `YYYY-MM-DD` til en lokal Date ved midnatt, uten UTC-forskyvning. */
export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

/** Motsatt vei: lokal Date til `YYYY-MM-DD`. */
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
 * Start og slutt (inklusive) for et tidsintervall, som ISO-datoer.
 * Returnerer null for 'alle'.
 *
 * Uka regnes mandag–søndag. «I helga» er kommende fredag til søndag —
 * er det allerede helg, er det denne helga, ikke neste.
 */
export function rangeBounds(range: TimeRange, today: string): { from: string; to: string } | null {
  if (range === 'alle') return null

  const start = parseIsoDate(today)
  // getDay(): 0 = søndag. Vi vil ha 0 = mandag.
  const weekday = (start.getDay() + 6) % 7

  switch (range) {
    case 'i-kveld':
      return { from: today, to: today }

    case 'i-helga': {
      // Fredag = 4. Er vi forbi fredag, er helga allerede i gang.
      const daysToFriday = weekday <= 4 ? 4 - weekday : 0
      const friday = addDays(start, daysToFriday)
      const sunday = addDays(start, 6 - weekday)
      return { from: toIsoDate(friday > start ? friday : start), to: toIsoDate(sunday) }
    }

    case 'denne-uka':
      return { from: today, to: toIsoDate(addDays(start, 6 - weekday)) }

    case 'denne-maneden': {
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
 * «I dag», «I morgen», ellers «ons 21. aug» — brukes i kortets
 * første linje, der dato og klokkeslett står sammen.
 */
export function formatDayLabel(showDate: string, today: string): string {
  const date = showDate.slice(0, 10)
  if (date === today) return 'I dag'
  if (date === toIsoDate(addDays(parseIsoDate(today), 1))) return 'I morgen'

  return new Intl.DateTimeFormat('nb-NO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .format(parseIsoDate(date))
    .replace(/\.$/, '')
}
