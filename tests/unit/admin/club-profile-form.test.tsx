import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { ClubProfileForm } from '@/components/admin/club-profile-form'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// Handlingen skriver til databasen og laster opp logoen — her testes bare hva skjemaet sender.
vi.mock('@/app/admin-app/(protected)/my-club/actions', () => ({ saveClubProfileAction: vi.fn() }))

const CLUB_URL = 'https://tickethalo.com/clubs/latter-oslo'

function renderForm() {
  return render(
    <ClubProfileForm
      club={{
        name: 'Latter Oslo',
        city: 'Oslo',
        description: 'Stand-up every Thursday.',
        logo_url: 'https://example.com/logo.png',
        currency: 'NOK',
        lineup_deadline_days: null,
      }}
      locations={[
        { id: 'loc-1', name: 'Latter', address_line: 'Aker Brygge 1' },
        { id: 'loc-2', name: 'Chat Noir', address_line: null },
      ]}
      clubUrl={CLUB_URL}
      defaultLineupDeadlineDays={14}
    />,
  )
}

function submittedValues(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('No form rendered')
  return new FormData(form)
}

describe('club profile form', () => {
  beforeAll(() => {
    // Radix måler popoveren med ResizeObserver, som jsdom ikke har.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })

  beforeEach(() => vi.clearAllMocks())

  it('groups the fields under named sections, like Show details', () => {
    renderForm()

    const basics = screen.getByRole('group', { name: 'Basics' })
    expect(within(basics).getByLabelText('Club name')).toHaveValue('Latter Oslo')
    expect(within(basics).getByLabelText('Club page')).toHaveValue(CLUB_URL)

    const location = screen.getByRole('group', { name: 'Location' })
    expect(within(location).getByLabelText('City')).toHaveValue('Oslo')
    expect(within(location).getByRole('button', { name: 'Locations Latter +1' })).toBeInTheDocument()

    const tickets = screen.getByRole('group', { name: 'Tickets' })
    expect(within(tickets).getByRole('button', { name: 'Currency NOK — Norwegian krone' })).toBeInTheDocument()

    expect(within(screen.getByRole('group', { name: 'About' })).getByLabelText('About the club')).toHaveValue(
      'Stand-up every Thursday.',
    )
  })

  it('submits the same fields the save action reads', () => {
    const { container } = renderForm()
    const values = submittedValues(container)

    expect(values.get('name')).toBe('Latter Oslo')
    expect(values.get('city')).toBe('Oslo')
    expect(values.get('description')).toBe('Stand-up every Thursday.')
    expect(values.get('currency')).toBe('NOK')
    expect(values.get('existingLogoUrl')).toBe('https://example.com/logo.png')
    expect(values.getAll('locationId')).toEqual(['loc-1', 'loc-2'])
    expect(values.getAll('locationName')).toEqual(['Latter', 'Chat Noir'])
    expect(values.getAll('locationAddress')).toEqual(['Aker Brygge 1', ''])
    // Tomt felt betyr «følg plattformens standard», ikke null dager. Se
    // `saveClubProfileAction`.
    expect(values.get('lineup_deadline_days')).toBe('')
  })

  it('does not submit the club page link', () => {
    const { container } = renderForm()
    expect([...submittedValues(container).values()]).not.toContain(CLUB_URL)
  })

  it('adds a location from the dropdown to what is submitted', async () => {
    const { container } = renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Locations Latter +1' }))
    await act(async () => {})
    fireEvent.change(screen.getByLabelText('Location name'), { target: { value: 'Big Stage' } })
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'Karl Johans gate 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))

    const values = submittedValues(container)
    expect(values.getAll('locationName')).toEqual(['Latter', 'Chat Noir', 'Big Stage'])
    expect(values.getAll('locationAddress')).toEqual(['Aker Brygge 1', '', 'Karl Johans gate 1'])
    expect(values.getAll('locationId')).toEqual(['loc-1', 'loc-2', ''])
    expect(screen.getByRole('button', { name: 'Locations Latter +2' })).toBeInTheDocument()
  })

  it('picks another currency from the search', async () => {
    const { container } = renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Currency NOK — Norwegian krone' }))
    await act(async () => {})
    fireEvent.change(screen.getByLabelText('Search currencies'), { target: { value: 'euro' } })
    fireEvent.keyDown(screen.getByLabelText('Search currencies'), { key: 'Enter' })

    expect(submittedValues(container).get('currency')).toBe('EUR')
    expect(screen.getByRole('button', { name: 'Currency EUR — Euro' })).toBeInTheDocument()
  })

  it('copies the club page link and links to it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderForm()

    expect(screen.getByRole('link', { name: 'Open club page' })).toHaveAttribute('href', CLUB_URL)

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await act(async () => {})

    expect(writeText).toHaveBeenCalledWith(CLUB_URL)
    expect(toast.success).toHaveBeenCalledWith('Link copied.')
  })
})
