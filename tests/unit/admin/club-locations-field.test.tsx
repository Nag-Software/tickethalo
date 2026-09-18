import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ClubLocationsField } from '@/components/admin/club-locations-field'

const LOCATIONS = [
  { id: 'loc-backstage', name: 'Backstage', address_line: 'Skagenkaien 5, 4006 Stavanger' },
  { id: 'loc-kjeller', name: 'Kjelleren', address_line: null },
]

/** Det skjemaet faktisk sender: tre parallelle lister, én rad per sted. */
function submitted(container: HTMLElement) {
  const form = container.querySelector('form') as HTMLFormElement
  const data = new FormData(form)
  return {
    ids: data.getAll('locationId'),
    names: data.getAll('locationName'),
    addresses: data.getAll('locationAddress'),
  }
}

function renderField(locations = LOCATIONS) {
  return render(
    <form>
      <ClubLocationsField locations={locations} />
    </form>,
  )
}

describe('club venues field', () => {
  it('shows every venue with its name and address in the open', () => {
    renderField()
    expect(screen.getByLabelText('Venue 1 name')).toHaveValue('Backstage')
    expect(screen.getByLabelText('Venue 1 address')).toHaveValue('Skagenkaien 5, 4006 Stavanger')
    expect(screen.getByLabelText('Venue 2 name')).toHaveValue('Kjelleren')
    expect(screen.getByText(/venues you pick from when you create a show/)).toBeInTheDocument()
  })

  it('edits a saved venue in place and keeps its id, so linked shows follow', () => {
    const { container } = renderField()
    fireEvent.change(screen.getByLabelText('Venue 1 address'), { target: { value: 'Skagenkaien 7, 4006 Stavanger' } })

    expect(submitted(container)).toEqual({
      ids: ['loc-backstage', 'loc-kjeller'],
      names: ['Backstage', 'Kjelleren'],
      addresses: ['Skagenkaien 7, 4006 Stavanger', ''],
    })
  })

  it('requires an address on a new venue, but lets an old one without it stand', () => {
    renderField()
    fireEvent.click(screen.getByRole('button', { name: 'Add venue' }))
    fireEvent.change(screen.getByLabelText('Venue 3 name'), { target: { value: 'Folken' } })

    expect(screen.getByLabelText('Venue 3 address')).toBeRequired()
    expect(screen.getByLabelText('Venue 2 address')).not.toBeRequired()
  })

  it('submits all three values for every row, so the parallel lists stay aligned', () => {
    const { container } = renderField()
    fireEvent.click(screen.getByRole('button', { name: 'Add venue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Backstage' }))

    const { ids, names, addresses } = submitted(container)
    expect(ids).toEqual(['loc-kjeller', ''])
    expect(names).toHaveLength(2)
    expect(addresses).toHaveLength(2)
  })

  it('starts with one empty row when the club has no venues yet', () => {
    renderField([])
    expect(screen.getByLabelText('Venue 1 name')).toHaveValue('')
    expect(screen.getByLabelText('Venue 1 address')).not.toBeRequired()
  })
})
