import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BookerPreview } from '@/components/public/booker-preview'

describe('admin portal preview', () => {
  it('exposes the static preview as one descriptive image', () => {
    render(<BookerPreview />)
    expect(screen.getByRole('img')).toHaveAccessibleName(/4 of 7 spots booked/i)
  })

  it('shows the representative show title and booking status', () => {
    render(<BookerPreview />)
    expect(screen.getByText('Laugh-out Club night')).toBeVisible()
    expect(screen.getByText('4/7 spots filled')).toBeVisible()
  })

  it('shows booked and available lineup states', () => {
    render(<BookerPreview />)
    expect(screen.getAllByText('Booked')).toHaveLength(4)
    expect(screen.getAllByText('Available')).toHaveLength(3)
  })
})
