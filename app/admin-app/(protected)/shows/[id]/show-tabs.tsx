'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'

interface ShowTabsProps {
  showId: string
  active: string
  tabs: { key: string; label: string; badge?: number }[]
}

export function ShowTabs({ showId, active, tabs }: ShowTabsProps) {
  const activeRef = useRef<HTMLAnchorElement>(null)

  // På mobil får ikke alle fanene plass, så raden ruller sidelengs. Uten
  // dette kunne den valgte fanen ligge utenfor skjermen etter et klikk.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [active])

  return (
    <div className="border-b">
      <nav
        aria-label="Show sections"
        className="-mb-px flex overflow-x-auto px-1 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => (
          <Link
            key={t.key}
            ref={active === t.key ? activeRef : undefined}
            href={`/admin-app/shows/${showId}?tab=${t.key}`}
            aria-current={active === t.key ? 'page' : undefined}
            className={`flex shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors sm:px-4 sm:py-2.5 ${
              active === t.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                {t.badge}
              </span>
            )}
          </Link>
        ))}
      </nav>
    </div>
  )
}
