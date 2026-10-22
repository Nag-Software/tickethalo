'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { markLineupThreadReadAction } from '../actions'

/** Merker tråden som lest når den faktisk vises, og oppdaterer tallet i menyen. */
export function MarkThreadRead({ showId, unread }: { showId: string; unread: number }) {
  const router = useRouter()
  useEffect(() => {
    if (unread === 0) return
    let cancelled = false
    void markLineupThreadReadAction(showId).then(({ marked }) => {
      if (!cancelled && marked > 0) router.refresh()
    })
    return () => {
      cancelled = true
    }
  }, [showId, unread, router])
  return null
}
