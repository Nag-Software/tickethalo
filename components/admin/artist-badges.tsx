import type { ArtistStatus, EnergyLevel } from '@/types/database'

/**
 * Statusbrikkene for en komiker.
 *
 * Ligger her fordi lista og profilsiden må si det samme med samme farge — to
 * sett med `amber-100` som driver fra hverandre er hvordan en flate slutter å
 * føles som én.
 */

export const ARTIST_STATUS_LABELS: Record<ArtistStatus, string> = {
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  inactive: 'Inactive',
  flagged: 'Flagged',
}

const STATUS_COLORS: Record<ArtistStatus, string> = {
  pending_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  inactive: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  flagged: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
}

export const ENERGY_LABELS: Record<EnergyLevel, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  uncertain: 'Uncertain',
}

const ENERGY_COLORS: Record<EnergyLevel, string> = {
  high: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  low: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400',
  uncertain: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
}

const BASE = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium'

export function ArtistStatusBadge({ status }: { status: ArtistStatus }) {
  return <span className={`${BASE} ${STATUS_COLORS[status]}`}>{ARTIST_STATUS_LABELS[status] ?? status}</span>
}

export function ArtistEnergyBadge({ level }: { level: EnergyLevel }) {
  return <span className={`${BASE} ${ENERGY_COLORS[level]}`}>{ENERGY_LABELS[level] ?? level} energy</span>
}

export function FlaggedBadge() {
  return (
    <span className={`${BASE} bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400`}>Flagged</span>
  )
}
