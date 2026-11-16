import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { LocationField } from '@/components/artist/location-field'

function renderField() {
  const onChange = vi.fn()
  render(<LocationField value={null} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Choose location' }))
  return { onChange, search: screen.getByRole('combobox', { name: 'Search for a city' }) }
}

describe('location field', () => {
  beforeAll(() => {
    // Radix måler popoveren med ResizeObserver, som jsdom ikke har.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
    Element.prototype.scrollIntoView ??= () => {}
  })

  it('picks nothing on Enter before anything is typed', () => {
    const { onChange, search } = renderField()
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('picks the top match on Enter once something is typed', () => {
    const { onChange, search } = renderField()
    fireEvent.change(search, { target: { value: 'Stockh' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ city: 'Stockholm', country: 'SE' })
  })

  it('goes to the last starter row on ArrowUp from nothing highlighted', () => {
    const { onChange, search } = renderField()
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ city: 'London', country: 'GB' })
  })

  it('keeps an unlisted city and saves the country only when confirmed', () => {
    const { onChange, search } = renderField()
    fireEvent.change(search, { target: { value: 'Kraków' } })

    const use = screen.getByRole('button', { name: 'Use' })
    expect(use).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Another country'), { target: { value: 'PK' } })
    fireEvent.change(screen.getByLabelText('Another country'), { target: { value: 'PL' } })
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(use)
    expect(onChange).toHaveBeenCalledWith({ city: 'Kraków', country: 'PL' })
  })
})
