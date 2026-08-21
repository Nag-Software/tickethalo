'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'

const statusMessages: Record<string, { type: 'success' | 'error' | 'info'; message: string }> = {
  accepted: { type: 'success', message: 'You are confirmed for the show.' },
  filled_by_other: { type: 'error', message: 'The spot was filled by another artist before you could confirm.' },
  already_booked: { type: 'error', message: 'You are already confirmed for this show.' },
  declined: { type: 'info', message: 'The offer has been declined.' },
  denied: { type: 'error', message: 'This offer does not belong to your artist account.' },
  expired: { type: 'error', message: 'The offer has expired.' },
  cancelled: { type: 'error', message: 'The offer has been cancelled.' },
}

export function BookingOfferStatusToast({ status }: { status?: string }) {
  useEffect(() => {
    if (!status) return
    const toastData = statusMessages[status] ?? { type: 'info' as const, message: 'Status has been updated.' }
    toast[toastData.type](toastData.message)
  }, [status])

  return null
}