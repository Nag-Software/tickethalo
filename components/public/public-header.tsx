'use client'

import { useEffect, useState } from 'react'
import { SiteNav } from '@/components/landing/site-nav'
import { cn } from '@/lib/utils'

/**
 * EKSPERIMENTELL (branch experimental/landing-v2): samme navbar som forsiden,
 * lagt fast i toppen. Sidene som bruker denne har allerede 96px+ luft øverst,
 * og navbaren er 64px (80px fra `sm`), så ingenting havner under den.
 *
 * Headeren erklærer sin egen `.ev-surface`, fordi den også brukes på sider
 * som ikke ligger inne i et slikt scope (/artist-app, /booking-offer).
 *
 * @param tone Beholdt for API-ets skyld — alle offentlige sider er lyse nå.
 */
export function PublicHeader({ transparent, tone = 'light' }: { transparent?: boolean; tone?: 'dark' | 'light' }) {
  void transparent
  const [stuck, setStuck] = useState(false)

  // Gjennomsiktig øverst på siden; et matt lag og en hårstrek når man har scrollet.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'ev-surface fixed inset-x-0 top-0 z-[2000] border-b transition-colors duration-300',
        stuck ? 'border-[var(--ev-line)] bg-[var(--ev-bg)]/85 backdrop-blur-md' : 'border-transparent'
      )}
      data-tone={tone}
    >
      <SiteNav />
    </header>
  )
}
