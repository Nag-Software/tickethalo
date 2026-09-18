import { describe, expect, it } from 'vitest'
import { isLinkedTo, resolveVenueSelection, searchLocations, showVenue } from '@/lib/show-venue'

const LOCATIONS = [
  { id: 'loc-backstage', name: 'Backstage', address_line: 'Skagenkaien 5, 4006 Stavanger' },
  { id: 'loc-folken', name: 'Folken', address_line: 'Løkkeveien 24, 4008 Stavanger' },
  { id: 'loc-kjeller', name: 'Kjelleren', address_line: null },
]

describe('showVenue — one reading rule', () => {
  it('shows name as the venue and the address as its own line', () => {
    expect(showVenue({ venue_name: 'Backstage', venue_address: 'Skagenkaien 5' })).toEqual({
      venue: 'Backstage', address: 'Skagenkaien 5', line: 'Backstage, Skagenkaien 5',
    })
  })

  it('never says "coming" when only the address is known — the old single-field shows', () => {
    expect(showVenue({ venue_name: null, venue_address: 'Skagenkaien 5, 4006 Stavanger' })).toEqual({
      venue: 'Skagenkaien 5, 4006 Stavanger', address: null, line: 'Skagenkaien 5, 4006 Stavanger',
    })
  })

  it('does not repeat an address that only restates the name', () => {
    expect(showVenue({ venue_name: 'Backstage', venue_address: ' backstage ' }).address).toBeNull()
  })

  it('is empty when nothing is set, including blank strings and a missing show', () => {
    const empty = { venue: null, address: null, line: null }
    expect(showVenue({ venue_name: '  ', venue_address: '' })).toEqual(empty)
    expect(showVenue(null)).toEqual(empty)
  })
})

describe('searchLocations', () => {
  it('matches on the name and on the address', () => {
    expect(searchLocations(LOCATIONS, 'folk').map((location) => location.id)).toEqual(['loc-folken'])
    expect(searchLocations(LOCATIONS, 'skagen').map((location) => location.id)).toEqual(['loc-backstage'])
  })

  it('needs every word, in any order and case, across both fields', () => {
    expect(searchLocations(LOCATIONS, 'STAVANGER back').map((location) => location.id)).toEqual(['loc-backstage'])
    expect(searchLocations(LOCATIONS, 'back oslo')).toEqual([])
  })

  it("returns everything, in the club's own order, for an empty search", () => {
    expect(searchLocations(LOCATIONS, '  ')).toEqual(LOCATIONS)
  })
})

describe('resolveVenueSelection — what the show stores', () => {
  it("keeps the link when the text is still the location's own, in its spelling", () => {
    expect(
      resolveVenueSelection(
        { venue_name: 'backstage ', venue_address: 'skagenkaien 5, 4006 stavanger', club_location_id: 'loc-backstage' },
        LOCATIONS,
      ),
    ).toEqual({ venue_name: 'Backstage', venue_address: 'Skagenkaien 5, 4006 Stavanger', club_location_id: 'loc-backstage' })
  })

  it('drops the link when the booker rewrote the address by hand', () => {
    expect(
      resolveVenueSelection(
        { venue_name: 'Backstage', venue_address: 'Skagenkaien 7', club_location_id: 'loc-backstage' },
        LOCATIONS,
      ),
    ).toEqual({ venue_name: 'Backstage', venue_address: 'Skagenkaien 7', club_location_id: null })
  })

  it('ignores a location id the club does not own', () => {
    expect(
      resolveVenueSelection({ venue_name: 'Latter', venue_address: 'Aker Brygge', club_location_id: 'loc-other-club' }, LOCATIONS),
    ).toEqual({ venue_name: 'Latter', venue_address: 'Aker Brygge', club_location_id: null })
  })

  it('links a name typed by hand to the saved location and fills its address', () => {
    expect(resolveVenueSelection({ venue_name: 'folken', venue_address: '', club_location_id: null }, LOCATIONS)).toEqual({
      venue_name: 'Folken', venue_address: 'Løkkeveien 24, 4008 Stavanger', club_location_id: 'loc-folken',
    })
  })

  it('does not link a typed name when the address says it is somewhere else', () => {
    expect(
      resolveVenueSelection({ venue_name: 'Folken', venue_address: 'Storgata 1, Oslo', club_location_id: null }, LOCATIONS).club_location_id,
    ).toBeNull()
  })

  it('stores free text as typed, and nothing as null', () => {
    expect(resolveVenueSelection({ venue_name: ' Sentrum Scene ', venue_address: '', club_location_id: null }, LOCATIONS)).toEqual({
      venue_name: 'Sentrum Scene', venue_address: null, club_location_id: null,
    })
    expect(resolveVenueSelection({ venue_name: '', venue_address: '', club_location_id: null }, LOCATIONS)).toEqual({
      venue_name: null, venue_address: null, club_location_id: null,
    })
  })

  it('treats a location without an address as linked only while the address is empty', () => {
    const kjeller = LOCATIONS[2]
    expect(isLinkedTo({ venue_name: 'Kjelleren', venue_address: '' }, kjeller)).toBe(true)
    expect(isLinkedTo({ venue_name: 'Kjelleren', venue_address: 'Bakgata 2' }, kjeller)).toBe(false)
  })
})
