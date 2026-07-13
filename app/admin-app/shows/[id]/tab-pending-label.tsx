'use client'

import * as React from 'react'
import { useLinkStatus } from 'next/link'

/**
 * Rendered inside a tab <Link>: pulses the clicked tab subtly while the
 * navigation is pending. The 100ms animation delay keeps fast (prefetched)
 * transitions flash-free.
 */
export function TabPendingLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus()

  return (
    <span
      className={`inline-flex items-center ${pending ? 'animate-pulse' : ''}`}
      style={pending ? { animationDelay: '100ms', animationDuration: '1.1s' } : undefined}
    >
      {children}
    </span>
  )
}
