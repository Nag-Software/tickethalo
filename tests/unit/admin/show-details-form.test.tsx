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
  venue_address: 'Skagenkaien 5, 4006 Stavanger',
  capacity: '70',
  ticket_price: '275',
  description: '',
}

function renderForm() {
  const action = vi.fn<(formData: FormData) => Promise<void>>().mockResolvedValue(undefined)
  render(
    <ShowDetailsForm
      showId="show-1"
      currency="NOK"
      eventsBaseUrl="https://tickethalo.com/events/"
      initialValues={VALUES}
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
    expect(within(when).getByLabelText('Venue / address')).toHaveValue('Skagenkaien 5, 4006 Stavanger')

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

  it('holds autosave and marks the field while a required field is empty', async () => {
    const { action } = renderForm()

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  ' } })
    await wait(1000)

    expect(action).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Title is required')
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true')
  })
})
