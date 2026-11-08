'use client'

import { useState } from 'react'

/**
 * EKSPERIMENTELL (branch experimental/landing-v2) — ikke merge til main.
 *
 * Klubben får 90 % av billettprisen; Tickethalo dekker kortgebyrene av sine
 * 10 %. Kalkulatoren viser bare det — ingen skjulte ledd å forklare.
 */
const CLUB_SHARE = 0.9

const kr = (n: number) => `NOK ${Math.round(n).toLocaleString('en-GB')}`

export function PayoutCalculator() {
  const [price, setPrice] = useState(300)
  const [tickets, setTickets] = useState(120)

  return (
    <div className="rounded-[24px] bg-[var(--ev-card)] p-5 ring-1 sm:rounded-[32px] sm:p-6 ring-inset ring-[var(--ev-line)] md:p-8">
      <label className="block">
        <span className="flex items-baseline justify-between text-[15px] text-[var(--ev-muted)]">
          Ticket price <strong className="text-[20px] font-semibold text-[var(--ev-text)]">{kr(price)}</strong>
        </span>
        <input
          type="range"
          min={100}
          max={800}
          step={10}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          className="mt-3 h-6 w-full cursor-pointer accent-[var(--ev-accent-fill)]"
        />
      </label>
      <label className="mt-6 block">
        <span className="flex items-baseline justify-between text-[15px] text-[var(--ev-muted)]">
          Tickets sold <strong className="text-[20px] font-semibold text-[var(--ev-text)]">{tickets}</strong>
        </span>
        <input
          type="range"
          min={10}
          max={500}
          step={10}
          value={tickets}
          onChange={(e) => setTickets(Number(e.target.value))}
          className="mt-3 h-6 w-full cursor-pointer accent-[var(--ev-accent-fill)]"
        />
      </label>

      <div className="mt-8 border-t border-[var(--ev-line)] pt-6">
        <p className="text-[15px] text-[var(--ev-muted)]">Your club gets paid</p>
        <p className="mt-1 text-[38px] font-bold leading-none sm:text-[44px] tracking-[-0.03em] tabular-nums [font-family:var(--font-display)] md:text-[56px]">
          {kr(price * tickets * CLUB_SHARE)}
        </p>
        <p className="mt-2 text-[14px] text-[var(--ev-faint)]">
          {kr(price * CLUB_SHARE)} per ticket. We pay the card fees, not you.
        </p>
      </div>
    </div>
  )
}
