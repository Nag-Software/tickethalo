'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { setArtistStatusAction } from './actions'
import type { ArtistStatus } from '@/types/database'

const OPTIONS: Array<{ value: ArtistStatus; label: string }> = [
  { value: 'approved', label: 'Active' },
  { value: 'inactive', label: 'Inactive — paused' },
  { value: 'rejected', label: 'Rejected — off the platform' },
]

/**
 * Statusvelgeren i komikerlisten.
 *
 * Å ta noen ut rammer alle klubber på én gang, så det spør først — og sier
 * hvor mange kommende bookinger komikeren står i. Å slippe noen inn igjen
 * spør ikke.
 */
export function ArtistStatusControl({
  artistId,
  artistName,
  status,
  upcomingBookings,
}: {
  artistId: string
  artistName: string
  status: ArtistStatus
  upcomingBookings: number
}) {
  const router = useRouter()
  const [value, setValue] = useState(status)
  const [isPending, startTransition] = useTransition()

  function change(next: ArtistStatus) {
    if (next === value) return

    if (next !== 'approved') {
      const bookings = upcomingBookings > 0
        ? ` They are in ${upcomingBookings} ${upcomingBookings === 1 ? 'upcoming booking' : 'upcoming bookings'}, which are not removed automatically.`
        : ''
      const ok = window.confirm(
        `Take ${artistName} off the platform? They lose access to the portal and get no offers from any club.${bookings}`,
      )
      if (!ok) return
    }

    const previous = value
    setValue(next)

    const formData = new FormData()
    formData.set('artist_id', artistId)
    formData.set('status', next)

    startTransition(async () => {
      const result = await setArtistStatusAction(formData)
      if ('error' in result) {
        setValue(previous)
        toast.error(result.error)
        return
      }
      toast.success(next === 'approved' ? `${artistName} is active again.` : `${artistName} has been taken off the platform.`)
      router.refresh()
    })
  }

  // `pending_review` og `flagged` kan stå i gamle rader, men kan ikke velges.
  const legacy = !OPTIONS.some((option) => option.value === value)

  return (
    <select
      aria-label={`Status for ${artistName}`}
      value={value}
      disabled={isPending}
      onChange={(event) => change(event.target.value as ArtistStatus)}
      className="h-8 w-full max-w-56 rounded-full border border-input bg-background px-3 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
    >
      {legacy && <option value={value}>{value === 'flagged' ? 'Flagged (old status)' : 'Under review'}</option>}
      {OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}
