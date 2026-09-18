import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { ShowDetailsForm, type ShowDetailsValues } from '@/app/admin-app/(protected)/shows/[id]/show-details-form'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const VALUES: ShowDetailsValues = {
  title: 'Backstage Stand Up',
  slug: 'backstage-stand-up',
  date: '2026-10-17',
  start_time: '20:15',
  end_time: '22:00',
  venue_name: 'Backstage',
  venue_address: 'Skagenkaien 5, 4006 Stavanger',
  club_location_id: 'loc-backstage',
  save_location: '',
  capacity: '70',
  ticket_price: '275',
  description: '',
}

const LOCATIONS = [
  { id: 'loc-backstage', name: 'Backstage', address_line: 'Skagenkaien 5, 4006 Stavanger' },
  { id: 'loc-folken', name: 'Folken', address_line: 'Løkkeveien 24, 4008 Stavanger' },
]

type SaveResult = { error?: string; venue?: { venue_name: string | null; venue_address: string | null; club_location_id: string | null } } | void

function renderForm(initialValues: ShowDetailsValues = VALUES) {
  const action = vi.fn<(formData: FormData) => Promise<SaveResult>>().mockResolvedValue(undefined)
  render(
    <ShowDetailsForm
      showId="show-1"
      currency="NOK"
      locations={LOCATIONS}
      eventsBaseUrl="https://tickethalo.com/events/"
      initialValues={initialValues}
      action={action}
    />,
  )
  return { action }
}

async function wait(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

describe('show details form', () => {
  beforeAll(() => {
    // Radix måler popoveren med ResizeObserver, som jsdom ikke har.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => vi.useRealTimers())

  it('groups the fields under named sections', () => {
    renderForm()

    const basics = screen.getByRole('group', { name: 'Basics' })
    expect(within(basics).getByLabelText('Title')).toHaveValue('Backstage Stand Up')
    expect(within(basics).getByLabelText('Web address')).toHaveValue('backstage-stand-up')

    const when = screen.getByRole('group', { name: 'When & where' })
    expect(within(when).getByLabelText('Start')).toHaveValue('20:15')
    expect(within(when).getByLabelText('End')).toHaveValue('22:00')
    expect(within(when).getByLabelText('Venue')).toHaveValue('Backstage')
    expect(within(when).getByLabelText('Address')).toHaveValue('Skagenkaien 5, 4006 Stavanger')
    expect(within(when).getByText(/Linked to My club/)).toBeInTheDocument()

    const tickets = screen.getByRole('group', { name: 'Tickets' })
    expect(within(tickets).getByLabelText('Capacity')).toHaveValue(70)
    expect(within(tickets).getByText('seats')).toBeInTheDocument()
    expect(within(tickets).getByText('NOK')).toBeInTheDocument()

    expect(within(screen.getByRole('group', { name: 'About' })).getByLabelText('Description')).toBeInTheDocument()
  })

  it('shows the whole event address in front of the slug', () => {
    renderForm()
    const basics = screen.getByRole('group', { name: 'Basics' })
    expect(within(basics).getByText('tickethalo.com')).toBeInTheDocument()
    expect(within(basics).getByText('/events/')).toBeInTheDocument()
  })

  it('names the date button by its label and the date, weekday included', () => {
    renderForm()
    expect(screen.getByRole('button', { name: 'Date Sat 17 Oct 2026' })).toBeInTheDocument()
  })

  it('saves a date picked in the calendar as yyyy-MM-dd', async () => {
    const { action } = renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Date Sat 17 Oct 2026' }))
    await wait(0)
    fireEvent.click(screen.getByRole('button', { name: /October 24th, 2026/ }))
    await wait(0)

    expect(screen.getByRole('button', { name: 'Date Sat 24 Oct 2026' })).toBeInTheDocument()

    await wait(800)
    expect(action).toHaveBeenCalledTimes(1)
    expect(action.mock.calls[0][0].get('date')).toBe('2026-10-24')
  })

  it('copies the event link as it stands in the field', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await wait(0)

    expect(writeText).toHaveBeenCalledWith('https://tickethalo.com/events/backstage-stand-up')
    expect(toast.success).toHaveBeenCalledWith('Link copied.')
  })

  it('autosaves after the delay, not on every keystroke', async () => {
    const { action } = renderForm()

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Backstage Stand Up XL' } })
    await wait(799)
    expect(action).not.toHaveBeenCalled()

    await wait(1)
    expect(action).toHaveBeenCalledTimes(1)
    expect(action.mock.calls[0][0].get('title')).toBe('Backstage Stand Up XL')
  })

  it('picks a saved location: both fields are filled and the show is linked', async () => {
    const { action } = renderForm({ ...VALUES, venue_name: '', venue_address: '', club_location_id: '' })

    // Søket treffer adressen like godt som navnet.
    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'løkkeveien' } })
    await wait(0)
    const option = screen.getByRole('option', { name: /Folken/ })
    expect(screen.queryByRole('option', { name: /Backstage/ })).not.toBeInTheDocument()

    fireEvent.mouseDown(option)
    await wait(800)

    expect(screen.getByLabelText('Venue')).toHaveValue('Folken')
    expect(screen.getByLabelText('Address')).toHaveValue('Løkkeveien 24, 4008 Stavanger')
    const sent = action.mock.calls.at(-1)![0]
    expect(sent.get('venue_name')).toBe('Folken')
    expect(sent.get('venue_address')).toBe('Løkkeveien 24, 4008 Stavanger')
    expect(sent.get('club_location_id')).toBe('loc-folken')
  })

  it('unlinks when the address is edited by hand, and offers to save the place', async () => {
    const { action } = renderForm()

    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'Skagenkaien 7, 4006 Stavanger' } })
    await wait(800)

    expect(screen.queryByText(/Linked to My club/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Save to My club/)).toBeInTheDocument()
    const sent = action.mock.calls.at(-1)![0]
    expect(sent.get('club_location_id')).toBe('')
    expect(sent.get('venue_address')).toBe('Skagenkaien 7, 4006 Stavanger')
  })

  it('follows what the server stored: a typed name is linked and gets its address', async () => {
    const { action } = renderForm({ ...VALUES, venue_name: '', venue_address: '', club_location_id: '' })
    action.mockResolvedValue({
      venue: { venue_name: 'Backstage', venue_address: 'Skagenkaien 5, 4006 Stavanger', club_location_id: 'loc-backstage' },
    })

    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'backstage' } })
    await wait(800)
    await wait(0)

    expect(screen.getByLabelText('Venue')).toHaveValue('Backstage')
    expect(screen.getByLabelText('Address')).toHaveValue('Skagenkaien 5, 4006 Stavanger')
    expect(screen.getByText(/Linked to My club/)).toBeInTheDocument()
    // Det serveren svarte er lagret tilstand — ingen ny lagring av samme verdi.
    await wait(1000)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('holds autosave and marks the field while a required field is empty', async () => {
    const { action } = renderForm()

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  ' } })
    await wait(1000)

    expect(action).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Title is required')
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true')
  })
})
