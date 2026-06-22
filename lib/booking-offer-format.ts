import { formatArtistRole } from '@/lib/artist-roles'

export function formatBookingSpotLabel(roleName: string | null | undefined) {
  const label = formatArtistRole(roleName)
  if (!label) return roleName?.trim() || 'spot'
  if (label === 'Stand-up') return 'Klubbkveld'
  return label
}

export function formatBookingDate(value: string) {
  return new Intl.DateTimeFormat('nb-NO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`))
}

export function formatBookingHonorar(opts: {
  fee_amount?: number | null
  currency?: string | null
  compensation_type?: string | null
  compensation_amount?: number | null
  compensation_percent?: number | null
}) {
  if (opts.fee_amount != null) {
    return new Intl.NumberFormat('nb-NO', {
      style: 'currency',
      currency: opts.currency || 'NOK',
      maximumFractionDigits: 0,
    }).format(opts.fee_amount / 100)
  }
  if (opts.compensation_type === 'percent' && opts.compensation_percent != null) {
    return `${opts.compensation_percent}% av billettinntekter`
  }
  if (opts.compensation_type === 'fixed' && opts.compensation_amount != null) {
    return new Intl.NumberFormat('nb-NO', {
      style: 'currency',
      currency: opts.currency || 'NOK',
      maximumFractionDigits: 0,
      // compensation_amount is stored in øre, like fee_amount above.
    }).format(Number(opts.compensation_amount) / 100)
  }
  return 'Ikke oppgitt'
}
