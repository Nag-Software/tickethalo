import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * ClickUp 1an2gnpzuhd: «Open for submissions» så ut til å ikke gjøre noe før
 * bookeren byttet fane, og ble skrudd av igjen ved neste autolagring.
 */

const action = vi.hoisted(() => ({ resolve: null as null | (() => void) }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/actions/submissions', () => ({
  setSubmissionsAudienceAction: vi.fn(),
  setSubmissionsDeadlineAction: vi.fn(),
  setSuggestFromSubmissionsAction: vi.fn(),
  toggleRequirementSubmissionsAction: vi.fn(() => new Promise<void>((resolve) => { action.resolve = resolve })),
}))

const { SubmissionsToggle } = await import('@/app/admin-app/(protected)/shows/[id]/lineup-ui')
const { toggleRequirementSubmissionsAction } = await import('@/lib/actions/submissions')

describe('submissions switch', () => {
  it('flips at once, and tells the card holding its own copy once saved', async () => {
    const onChange = vi.fn()
    render(<SubmissionsToggle showId="show-1" reqId="req-1" open={false} disabled={false} onChange={onChange} />)

    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.textContent).toContain('Off')

    fireEvent.click(toggle)

    // Serveren har ikke svart ennå, men bryteren står allerede på.
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.textContent).toContain('On')
    const sent = vi.mocked(toggleRequirementSubmissionsAction).mock.calls[0][0] as FormData
    expect(sent.get('submissions_open')).toBe('true')
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => { action.resolve?.() })
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
