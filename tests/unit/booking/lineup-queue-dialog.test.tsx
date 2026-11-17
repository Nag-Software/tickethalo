import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LineupQueue, QueueComedian } from '@/lib/booking-engine'

/**
 * ClickUp 1an2gnpzucr: «Rydde i UI på auto-booking».
 *
 * Bookeren skal se at ingen får to tilbud på samme show, se høyst fem i køen,
 * og den som står øverst, skal være den sidepanelet sier blir spurt først.
 */

const queue = vi.hoisted(() => ({ value: null as unknown }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('@/app/admin-app/(protected)/shows/actions', () => ({
  getLineupQueueAction: vi.fn(async () => queue.value),
  saveLineupQueueAction: vi.fn(),
  startBookingAction: vi.fn(),
}))
vi.mock('@/lib/actions/submissions', () => ({
  setSubmissionsAudienceAction: vi.fn(),
  setSubmissionsDeadlineAction: vi.fn(),
  setSuggestFromSubmissionsAction: vi.fn(),
  toggleRequirementSubmissionsAction: vi.fn(),
}))

const { LineupQueueDialog } = await import('@/app/admin-app/(protected)/shows/[id]/lineup-queue-dialog')

function comedian(name: string): QueueComedian {
  return {
    artistId: name.toLowerCase(),
    name,
    initials: name.slice(0, 2).toUpperCase(),
    imageUrl: null,
    skillLevel: 'medium',
    lastClubBookingDate: null,
  }
}

const hostQueue = ['Ida', 'Bo', 'Cy', 'Dan', 'Eva', 'Fay', 'Gus'].map(comedian)

function spot(overrides: Partial<Extract<LineupQueue, { ok: true }>['spots'][number]>) {
  return {
    requirementId: 'r',
    position: 1,
    roleName: 'Host',
    minSkillLevel: null,
    durationMinutes: 10,
    matchCount: 7,
    note: null,
    slotsNeeded: 1,
    nowCount: 1,
    tomorrowCount: 1,
    queue: [],
    asked: [],
    addable: [],
    ...overrides,
  }
}

queue.value = {
  ok: true,
  show: { date: '2026-12-02', venue: 'Club', lineupDeadline: '2026-11-25', started: false },
  rush: false,
  spots: [
    spot({ requirementId: 'host', position: 1, roleName: 'Host', queue: hostQueue }),
    // Færre kandidater: Middle velger først og tar Ida.
    spot({ requirementId: 'middle', position: 2, roleName: 'Middle', queue: [comedian('Ida'), comedian('Bo')] }),
  ],
} satisfies LineupQueue

describe('review your line-up', () => {
  it('moves a comedian offered elsewhere out of the queue and keeps the top in line with the side panel', async () => {
    render(<LineupQueueDialog showId="show-1" open onOpenChange={() => {}} mode="start" />)

    const list = await screen.findByRole('list', { name: 'Queue for Host' })
    const names = within(list).getAllByRole('listitem').map((item) => item.textContent ?? '')

    // Ida er ikke i køen her — hen står nederst, med plassen hen får tilbud på.
    expect(names.some((text) => text.includes('Ida'))).toBe(false)
    const elsewhere = screen.getByRole('list', { name: 'Asked for another spot' })
    expect(elsewhere.textContent).toContain('Ida')
    expect(elsewhere.textContent).toContain('Gets #2 Middle instead')

    // Den øverste i køen er den sidepanelet sier blir spurt først.
    expect(names.find((text) => /Bo|Cy|Dan/.test(text))).toContain('Bo')
    const side = within(screen.getByRole('navigation', { name: 'Lineup spots' })).getAllByRole('button')
    expect(side[0].textContent).toContain('Bo first')
    expect(screen.getByRole('button', { name: 'Move Bo up' })).toHaveProperty('disabled', true)

    // Fem vises, resten ligger bak «Show more».
    expect(within(list).queryByText('Gus')).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: 'Show 1 more in the queue' }))
    expect(within(list).getByText('Gus')).toBeTruthy()

    // Garantien står framme, og bunnlinjen teller ulike komikere.
    expect(screen.getByText('One spot per comedian.')).toBeTruthy()
    expect(screen.getByText(/to two different comedians · 2 spots/)).toBeTruthy()

    // Hvordan køen virker, står bak Help.
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    expect(await screen.findByText('Who gets asked first')).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    // Plassen Ida får tilbud på, er ett klikk unna.
    fireEvent.click(within(elsewhere).getByRole('button', { name: /Gets #2 Middle instead/ }))
    expect(await screen.findByRole('list', { name: 'Queue for Middle' })).toBeTruthy()
  })
})
