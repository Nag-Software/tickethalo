import { describe, expect, it } from 'vitest'
import {
  matchesHardRequirements,
  offerQuota,
  pendingOffersToWithdraw,
  type ExistingOffer,
  type HardRequirement,
  type MatchableArtist,
} from '@/lib/booking-rules'

const standUpSpot: HardRequirement = { role_name: 'Stand-up', energy_level: 'low', required_gender: 'man' }
const hostSpot: HardRequirement = { role_name: 'Host', energy_level: 'any', required_gender: 'any' }

const lowEnergyStandUp: MatchableArtist = { category: ['stand-up'], admin_energy_level: 'low', gender: 'man' }
const unratedStandUp: MatchableArtist = { category: ['stand-up', 'open mic'], admin_energy_level: null, gender: 'man' }

function offer(overrides: Partial<ExistingOffer> = {}): ExistingOffer {
  return {
    id: 'offer-1',
    artist_id: 'artist-1',
    show_requirement_id: 'spot-standup',
    status: 'sent',
    source: 'auto',
    ...overrides,
  }
}

function withdraw(offers: ExistingOffer[], options: {
  artists?: Record<string, MatchableArtist>
  excluded?: string[]
} = {}) {
  return pendingOffersToWithdraw({
    offers,
    bookableArtists: new Map(Object.entries(options.artists ?? { 'artist-1': unratedStandUp })),
    requirements: new Map([['spot-standup', standUpSpot], ['spot-host', hostSpot]]),
    excludedArtistIds: new Set(options.excluded ?? []),
  })
}

describe('hard requirements', () => {
  it('matches role, energy and gender', () => {
    expect(matchesHardRequirements(lowEnergyStandUp, standUpSpot)).toBe(true)
  })

  it('rejects a comedian the club has not given the role', () => {
    expect(matchesHardRequirements(lowEnergyStandUp, hostSpot)).toBe(false)
  })

  it('rejects a comedian without an energy rating on a spot that asks for one', () => {
    expect(matchesHardRequirements(unratedStandUp, standUpSpot)).toBe(false)
    expect(matchesHardRequirements(unratedStandUp, { ...standUpSpot, energy_level: 'any' })).toBe(true)
  })

  it('only lets prefer_not_to_say match a spot open to any gender', () => {
    const artist: MatchableArtist = { ...lowEnergyStandUp, gender: 'prefer_not_to_say' }
    expect(matchesHardRequirements(artist, standUpSpot)).toBe(false)
    expect(matchesHardRequirements(artist, { ...standUpSpot, required_gender: 'any' })).toBe(true)
  })
})

describe('pending offers the engine withdraws', () => {
  it('withdraws an engine offer when the comedian no longer matches the spot', () => {
    expect(withdraw([offer({ source: 'auto' })])).toEqual(['offer-1'])
  })

  it('keeps an engine offer that still matches', () => {
    expect(withdraw([offer({ source: 'auto' })], { artists: { 'artist-1': lowEnergyStandUp } })).toEqual([])
  })

  it('keeps an offer the booker sent to a comedian who does not match the spot', () => {
    // Samme situasjon som i produksjon 17. september: manuelt tilbud på en
    // Stand-up-plass med lav energi, til en komiker klubben ikke har gitt
    // energinivå. Før rettelsen ble det trukket neste gang motoren kjørte.
    expect(withdraw([offer({ source: 'manual' })])).toEqual([])
    expect(withdraw([offer({ source: 'manual', show_requirement_id: 'spot-host' })])).toEqual([])
  })

  it('still withdraws a manual offer when the comedian is excluded from the show', () => {
    expect(withdraw([offer({ source: 'manual' })], { excluded: ['artist-1'] })).toEqual(['offer-1'])
  })

  it('still withdraws a manual offer when the club can no longer book the comedian', () => {
    // Ikke i `bookableArtists`: fjernet fra listen, flagget eller ikke godkjent.
    expect(withdraw([offer({ source: 'manual' })], { artists: {} })).toEqual(['offer-1'])
  })

  it('withdraws an offer whose spot is gone', () => {
    expect(withdraw([offer({ source: 'manual', show_requirement_id: 'spot-deleted' })])).toEqual(['offer-1'])
  })

  it('ignores offers that are already answered or have no spot', () => {
    expect(withdraw([
      offer({ id: 'accepted', status: 'accepted' }),
      offer({ id: 'declined', status: 'declined' }),
      offer({ id: 'expired', status: 'expired' }),
      offer({ id: 'no-spot', show_requirement_id: null }),
    ])).toEqual([])
  })
})

describe('offer quota per spot', () => {
  it('fills an open seat up to offers_per_slot engine offers', () => {
    expect(offerQuota({ quantity: 1, filled: 0, pendingAuto: 3, pendingManual: 0, offersPerSlot: 10 }))
      .toEqual({ slotsNeeded: 1, currentPendingOffers: 3, maxNewOffers: 7 })
  })

  it('sends nothing on a filled spot', () => {
    expect(offerQuota({ quantity: 1, filled: 1, pendingAuto: 0, pendingManual: 0, offersPerSlot: 10 }))
      .toEqual({ slotsNeeded: 0, currentPendingOffers: 0, maxNewOffers: 0 })
  })

  it('leaves a seat alone while the booker’s own offer waits for a reply', () => {
    expect(offerQuota({ quantity: 1, filled: 0, pendingAuto: 0, pendingManual: 1, offersPerSlot: 10 }))
      .toEqual({ slotsNeeded: 0, currentPendingOffers: 0, maxNewOffers: 0 })
  })

  it('keeps working the other seats on a spot with several', () => {
    expect(offerQuota({ quantity: 3, filled: 1, pendingAuto: 4, pendingManual: 1, offersPerSlot: 10 }))
      .toEqual({ slotsNeeded: 1, currentPendingOffers: 4, maxNewOffers: 6 })
  })

  it('never goes negative when there are more offers than the quota', () => {
    expect(offerQuota({ quantity: 1, filled: 0, pendingAuto: 12, pendingManual: 3, offersPerSlot: 10 }))
      .toEqual({ slotsNeeded: 0, currentPendingOffers: 12, maxNewOffers: 0 })
  })
})
