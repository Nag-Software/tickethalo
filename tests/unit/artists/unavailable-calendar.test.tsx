import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnavailableCalendar } from '@/components/artist/unavailable-calendar'
import { saveUnavailableDatesAction } from '@/app/artist-app/actions'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))
vi.mock('@/app/artist-app/actions', () => ({ saveUnavailableDatesAction: vi.fn() }))

/**
 * Kalenderen lagrer fortløpende og sender bare det som er endret. Testene
 * her handler om nettopp det: hva som havner i `add` og `remove`, og hva som
 * skjer når lagringen ikke går gjennom.
 *
 * Draget må simuleres med `elementFromPoint`, som jsdom ikke har. Det er den
 * samme veien komponenten går i en ekte nettleser når en finger dras over
 * rutenettet: peker-hendelsene fanges av elementet draget startet på, så
 * dagen under fingeren må slås opp på koordinatene.
 */

const TODAY = new Date('2026-03-10T09:00:00Z')

function dayButton(container: HTMLElement, date: string) {
  const button = container.querySelector<HTMLButtonElement>(`[data-cal-date="${date}"]`)
  if (!button) throw new Error(`No day button for ${date}`)
  return button
}

/** Lar `elementFromPoint` svare med dagen testen peker på. jsdom har den ikke. */
function pointAt(button: HTMLElement) {
  document.elementFromPoint = () => button
  return { clientX: 1, clientY: 1 }
}

function renderCalendar(props: Partial<Parameters<typeof UnavailableCalendar>[0]> = {}) {
  return render(
    <UnavailableCalendar
      initialUnavailable={[]}
      booked={[]}
      pendingOffer={[]}
      {...props}
    />,
  )
}

describe('the unavailable-dates calendar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(TODAY)
    vi.clearAllMocks()
    // Serveren svarer med hva den faktisk lagret. Kalenderen stemmer av mot
    // det, så en dato den forkaster ikke blir stående og se lagret ut.
    vi.mocked(saveUnavailableDatesAction).mockImplementation(async (input) =>
      ({ ok: true, added: input.add ?? [], removed: input.remove ?? [] }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('marks a day with one tap, and sends only that day', async () => {
    const { container } = renderCalendar()
    const day = dayButton(container, '2026-03-20')

    await act(async () => { fireEvent.click(day) })

    await waitFor(() => expect(saveUnavailableDatesAction).toHaveBeenCalledWith({
      add: ['2026-03-20'],
      remove: [],
      declineOffersOn: [],
    }))
    expect(day.getAttribute('aria-pressed')).toBe('true')
  })

  it('clears a day that was already marked', async () => {
    const { container } = renderCalendar({ initialUnavailable: ['2026-03-20'] })
    const day = dayButton(container, '2026-03-20')
    expect(day.getAttribute('aria-pressed')).toBe('true')

    await act(async () => { fireEvent.click(day) })

    await waitFor(() => expect(saveUnavailableDatesAction).toHaveBeenCalledWith({
      add: [],
      remove: ['2026-03-20'],
      declineOffersOn: [],
    }))
  })

  it('paints a run of days in one drag', async () => {
    const { container } = renderCalendar()
    const first = dayButton(container, '2026-03-20')

    await act(async () => {
      fireEvent.pointerDown(first, { ...pointAt(first), button: 0, buttons: 1 })
      fireEvent.pointerMove(first, { ...pointAt(dayButton(container, '2026-03-21')), buttons: 1 })
      fireEvent.pointerMove(first, { ...pointAt(dayButton(container, '2026-03-22')), buttons: 1 })
      fireEvent.pointerUp(first, pointAt(dayButton(container, '2026-03-22')))
    })

    await waitFor(() => expect(saveUnavailableDatesAction).toHaveBeenCalledTimes(1))
    expect(saveUnavailableDatesAction).toHaveBeenCalledWith({
      add: ['2026-03-20', '2026-03-21', '2026-03-22'],
      remove: [],
      declineOffersOn: [],
    })
  })

  // Pekeren måles med mellomrom. Et raskt dra over en uke traff bare start
  // og slutt, og etterlot hull komikeren ikke så.
  it('fills the whole run between two samples, not just the cells it touched', async () => {
    const { container } = renderCalendar()
    const first = dayButton(container, '2026-03-16')

    await act(async () => {
      fireEvent.pointerDown(first, { ...pointAt(first), button: 0, buttons: 1 })
      fireEvent.pointerMove(first, { ...pointAt(dayButton(container, '2026-03-22')), buttons: 1 })
      fireEvent.pointerUp(first, pointAt(dayButton(container, '2026-03-22')))
    })

    await waitFor(() => expect(saveUnavailableDatesAction).toHaveBeenCalledWith({
      add: ['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20', '2026-03-21', '2026-03-22'],
      remove: [],
      declineOffersOn: [],
    }))
  })

  // Et dra ender som regel på en annen dag enn det startet på. Da får ingen
  // dagknapp noe klikk, og flagget som skal svelge klikket ble stående —
  // så det neste trykket forsvant i stillhet.
  it('does not swallow the next tap after a drag', async () => {
    const { container } = renderCalendar()
    const first = dayButton(container, '2026-03-20')

    await act(async () => {
      fireEvent.pointerDown(first, { ...pointAt(first), button: 0, buttons: 1 })
      fireEvent.pointerMove(first, { ...pointAt(dayButton(container, '2026-03-21')), buttons: 1 })
      fireEvent.pointerUp(first, pointAt(dayButton(container, '2026-03-21')))
    })
    await waitFor(() => expect(saveUnavailableDatesAction).toHaveBeenCalledTimes(1))

    const later = dayButton(container, '2026-03-28')
    await act(async () => {
      fireEvent.pointerDown(later, { ...pointAt(later), button: 0, buttons: 1 })
      fireEvent.pointerUp(later, pointAt(later))
      fireEvent.click(later)
    })

    await waitFor(() => expect(saveUnavailableDatesAction).toHaveBeenCalledTimes(2))
    expect(later.getAttribute('aria-pressed')).toBe('true')
  })

  // Høyreklikk åpner menyen, som spiser `pointerup`. Uten en sjekk på hvilken
  // knapp som ble trykket, malte musa videre uten at noen knapp var nede.
  it('ignores a right-click', async () => {
    const { container } = renderCalendar()
    const day = dayButton(container, '2026-03-20')

    await act(async () => {
      fireEvent.pointerDown(day, { ...pointAt(day), button: 2, buttons: 2 })
      fireEvent.pointerMove(day, { ...pointAt(dayButton(container, '2026-03-21')), buttons: 0 })
    })

    expect(saveUnavailableDatesAction).not.toHaveBeenCalled()
    expect(dayButton(container, '2026-03-21').getAttribute('aria-pressed')).toBe('false')
  })

  // To raske trykk regnet begge mot den samme gamle lagrede tilstanden. Den
  // ene runden kunne både utelate en endring og rulle kalenderen tilbake
  // forbi noe den andre nettopp hadde lagret.
  it('serialises saves, so a quick second tap is not lost', async () => {
    let release: (() => void) | null = null
    vi.mocked(saveUnavailableDatesAction).mockImplementationOnce(async (input) => {
      await new Promise<void>((resolve) => { release = resolve })
      return { ok: true, added: input.add ?? [], removed: input.remove ?? [] }
    })

    const { container } = renderCalendar()

    await act(async () => { fireEvent.click(dayButton(container, '2026-03-20')) })
    await act(async () => { fireEvent.click(dayButton(container, '2026-03-21')) })

    expect(saveUnavailableDatesAction).toHaveBeenCalledTimes(1)

    await act(async () => { release?.() })

    await waitFor(() => expect(saveUnavailableDatesAction).toHaveBeenCalledTimes(2))
    expect(saveUnavailableDatesAction).toHaveBeenLastCalledWith({
      add: ['2026-03-21'],
      remove: [],
      declineOffersOn: [],
    })
  })

  // Serveren forkaster en dag som rakk å bli i går. Uten at kalenderen
  // stemmer av mot svaret, ble den stående og vise en markering som ikke
  // fantes noe sted — og ingen senere lagring ville prøvd å legge den inn.
  it('drops a date the server refused, instead of showing it as saved', async () => {
    vi.mocked(saveUnavailableDatesAction).mockResolvedValueOnce({ ok: true, added: [], removed: [] })

    const { container } = renderCalendar()
    const day = dayButton(container, '2026-03-20')

    await act(async () => { fireEvent.click(day) })

    await waitFor(() => expect(day.getAttribute('aria-pressed')).toBe('false'))
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('already been'))
  })

  // Et kast fra handlingen — nettverk, utløpt sesjon, en deploy midt i —
  // etterlot markeringer som aldri ble lagret, uten et ord til komikeren.
  it('rolls back and says so when the action throws', async () => {
    vi.mocked(saveUnavailableDatesAction).mockRejectedValueOnce(new Error('network'))

    const { container } = renderCalendar()
    const day = dayButton(container, '2026-03-20')

    await act(async () => { fireEvent.click(day) })

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(day.getAttribute('aria-pressed')).toBe('false')
  })

  it('clears a run when the drag starts on a marked day', async () => {
    const { container } = renderCalendar({ initialUnavailable: ['2026-03-20', '2026-03-21'] })
    const first = dayButton(container, '2026-03-20')

    await act(async () => {
      fireEvent.pointerDown(first, { ...pointAt(first), button: 0, buttons: 1 })
      fireEvent.pointerMove(first, { ...pointAt(dayButton(container, '2026-03-21')), buttons: 1 })
      fireEvent.pointerUp(first, pointAt(dayButton(container, '2026-03-21')))
    })

    await waitFor(() => expect(saveUnavailableDatesAction).toHaveBeenCalledWith({
      add: [],
      remove: ['2026-03-20', '2026-03-21'],
      declineOffersOn: [],
    }))
  })

  it('refuses a day the comedian is booked on, and says why', async () => {
    const { container } = renderCalendar({ booked: ['2026-03-20'] })

    await act(async () => { fireEvent.click(dayButton(container, '2026-03-20')) })

    expect(saveUnavailableDatesAction).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('booked that evening'))
  })

  it('locks days that have been', async () => {
    const { container } = renderCalendar()
    // 1. mars er synlig i inneværende måned, men passert.
    expect(dayButton(container, '2026-03-01').disabled).toBe(true)

    await act(async () => { fireEvent.click(dayButton(container, '2026-03-01')) })
    expect(saveUnavailableDatesAction).not.toHaveBeenCalled()
  })

  it('asks before turning down an offer, and only saves once confirmed', async () => {
    vi.mocked(saveUnavailableDatesAction).mockResolvedValueOnce({ needsConfirm: ['2026-03-20'] })

    const { container, getByRole, getByText } = renderCalendar({ pendingOffer: ['2026-03-20'] })
    const day = dayButton(container, '2026-03-20')

    await act(async () => { fireEvent.click(day) })

    await waitFor(() => getByRole('alertdialog'))
    // Markeringen rulles tilbake mens komikeren bestemmer seg — den er ikke
    // lagret noe sted ennå.
    expect(day.getAttribute('aria-pressed')).toBe('false')

    await act(async () => { fireEvent.click(getByText('Mark it and turn the offer down')) })

    // Datoene sendes med, ikke bare et «ja»: kommer et nytt tilbud inn mens
    // dialogen står åpen, skal serveren spørre på nytt.
    await waitFor(() => expect(saveUnavailableDatesAction).toHaveBeenLastCalledWith({
      add: ['2026-03-20'],
      remove: [],
      declineOffersOn: ['2026-03-20'],
    }))
  })

  it('keeps the offer when the comedian backs out of the dialog', async () => {
    vi.mocked(saveUnavailableDatesAction).mockResolvedValueOnce({ needsConfirm: ['2026-03-20'] })

    const { container, getByText, queryByRole } = renderCalendar({ pendingOffer: ['2026-03-20'] })

    await act(async () => { fireEvent.click(dayButton(container, '2026-03-20')) })
    await waitFor(() => expect(queryByRole('alertdialog')).not.toBeNull())

    await act(async () => { fireEvent.click(getByText('Keep the offer')) })

    expect(queryByRole('alertdialog')).toBeNull()
    expect(saveUnavailableDatesAction).toHaveBeenCalledTimes(1)
  })

  it('rolls the calendar back when saving fails', async () => {
    vi.mocked(saveUnavailableDatesAction).mockResolvedValueOnce({ error: 'No connection.' })

    const { container } = renderCalendar()
    const day = dayButton(container, '2026-03-20')

    await act(async () => { fireEvent.click(day) })

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No connection.'))
    expect(day.getAttribute('aria-pressed')).toBe('false')
  })

  it('leaves the offer alone when the comedian backs out, and forgets the confirmation', async () => {
    vi.mocked(saveUnavailableDatesAction).mockResolvedValueOnce({ needsConfirm: ['2026-03-20'] })

    const { container, getByText } = renderCalendar({ pendingOffer: ['2026-03-20'] })

    await act(async () => { fireEvent.click(dayButton(container, '2026-03-20')) })
    await waitFor(() => getByText('Keep the offer'))
    await act(async () => { fireEvent.click(getByText('Keep the offer')) })

    // Neste lagring skal ikke arve en bekreftelse komikeren trakk tilbake.
    await act(async () => { fireEvent.click(dayButton(container, '2026-03-25')) })
    await waitFor(() => expect(saveUnavailableDatesAction).toHaveBeenLastCalledWith({
      add: ['2026-03-25'],
      remove: [],
      declineOffersOn: [],
    }))
  })
})
