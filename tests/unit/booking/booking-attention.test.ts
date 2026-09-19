import { describe, expect, it } from 'vitest'
import {
  bookingAttention,
  type AttentionRequirement,
  type AttentionShow,
} from '@/lib/booking-attention'
import { DEFAULT_BOOKING_SETTINGS } from '@/lib/booking-settings'

/**
 * Varslene er det eneste som sier fra når automatikken står fast. Hver test
 * har både en rad som skal utløse varselet og en som ikke skal — ellers
 * ville et varsel som alltid fyrer se like riktig ut.
 */

const NOW = new Date('2026-03-01T09:00:00Z')

function spot(overrides: Partial<AttentionRequirement> = {}): AttentionRequirement {
  return {
    id: 'spot-1',
    roleName: 'Headliner',
    quantity: 1,
    filled: 0,
    pendingAuto: 2,
    pendingManual: 0,
    oldestManualOfferAt: null,
    declined: 0,
    submissionsOpen: false,
    autoStarted: true,
    matching: 6,
    available: 4,
    relaxable: null,
    ...overrides,
  }
}

function show(overrides: Partial<AttentionShow> = {}): AttentionShow {
  return {
    id: 'show-1',
    title: 'Fredagsshow',
    date: '2026-03-27',
    status: 'booking',
    lineupDeadlineDays: 14,
    requirements: [spot()],
    pendingSubmissions: 0,
    unreviewedSpots: 0,
    clubPayoutReady: true,
    ...overrides,
  }
}

function run(shows: AttentionShow[]) {
  return bookingAttention({ shows, settings: DEFAULT_BOOKING_SETTINGS, now: NOW })
}

function keys(shows: AttentionShow[]) {
  return run(shows).map((alert) => alert.id.split(':')[1])
}

describe('ingen kandidater', () => {
  it('varsler når ingen på listen oppfyller kravene', () => {
    expect(keys([show({ requirements: [spot({ matching: 0, available: 0, pendingAuto: 0 })] })]))
      .toContain('no-candidates-spot-1')
  })

  it('sier hvilket krav som stenger, og hvor mange som slipper inn om det lempes', () => {
    const alerts = run([show({
      requirements: [spot({ matching: 0, available: 0, pendingAuto: 0, relaxable: { blocker: 'energy', count: 4 } })],
    })])
    const alert = alerts.find((row) => row.id.endsWith('no-candidates-spot-1'))
    expect(alert?.message).toContain('4 komikere passer om energinivået lempes')
  })

  it('varsler ikke når det finnes kandidater', () => {
    expect(keys([show()])).not.toContain('no-candidates-spot-1')
  })

  it('varsler ikke på en plass som er åpen for søknader — der er det ikke motoren som fyller', () => {
    expect(keys([show({ requirements: [spot({ matching: 0, available: 0, pendingAuto: 0, submissionsOpen: true })] })]))
      .not.toContain('no-candidates-spot-1')
  })
})

describe('kandidatene er brukt opp', () => {
  it('varsler når alle som passer har fått tilbud og ingen svar venter', () => {
    expect(keys([show({ requirements: [spot({ matching: 5, available: 0, pendingAuto: 0 })] })]))
      .toContain('exhausted-spot-1')
  })

  it('varsler ikke mens et tilbud fortsatt venter på svar', () => {
    expect(keys([show({ requirements: [spot({ matching: 5, available: 0, pendingAuto: 2 })] })]))
      .not.toContain('exhausted-spot-1')
  })

  it('varsler ikke mens bookerens eget tilbud holder plassen', () => {
    expect(keys([show({ requirements: [spot({ matching: 5, available: 0, pendingAuto: 0, pendingManual: 1 })] })]))
      .not.toContain('exhausted-spot-1')
  })
})

describe('fristen', () => {
  it('er kritisk når den er passert med ledige plasser', () => {
    // Fristen for et show 5. mars er 19. februar, altså passert.
    expect(keys([show({ date: '2026-03-05' })])).toContain('deadline-passed')
  })

  it('er en advarsel når den nærmer seg', () => {
    // Show 17. mars gir frist 3. mars — to dager fram, innenfor hastemodus.
    expect(keys([show({ date: '2026-03-17' })])).toContain('deadline-near')
  })

  it('sier ingenting i god tid', () => {
    const alerts = keys([show({ date: '2026-05-01' })])
    expect(alerts).not.toContain('deadline-near')
    expect(alerts).not.toContain('deadline-passed')
  })

  it('sier ingenting når lineupen er full', () => {
    const full = show({ date: '2026-03-05', requirements: [spot({ filled: 1, pendingAuto: 0 })] })
    expect(keys([full])).not.toContain('deadline-passed')
  })
})

describe('utkast', () => {
  it('varsler når fristen nærmer seg og bookingen ikke er startet', () => {
    expect(keys([show({ status: 'draft', date: '2026-03-20' })])).toContain('draft-late')
  })

  it('sier ingenting om et utkast langt fram i tid', () => {
    expect(keys([show({ status: 'draft', date: '2026-06-01' })])).not.toContain('draft-late')
  })

  it('tier om alt annet på et utkast — motoren har ikke begynt ennå', () => {
    const draft = show({
      status: 'draft',
      date: '2026-06-01',
      requirements: [spot({ matching: 0, available: 0, pendingAuto: 0 })],
    })
    expect(keys([draft])).toEqual([])
  })
})

describe('publisering', () => {
  it('varsler når et publisert show har mistet en komiker', () => {
    expect(keys([show({ status: 'published' })])).toContain('published-open')
  })

  // På showdagen sender motoren ingenting. Varselet sa likevel «systemet
  // fyller den igjen» — på den ene dagen det er feil.
  it('sier fra at det er bookeren som må ringe når showet er i kveld', () => {
    const tonight = run([show({ status: 'published', date: '2026-03-01' })])
      .find((alert) => alert.id.endsWith('published-open'))

    expect(tonight?.message).toContain('sender ikke tilbud på showdagen')
    expect(tonight?.action).toContain('Ring')
  })

  it('varsler når lineupen er full, men klubben ikke kan ta imot penger', () => {
    const ready = show({ requirements: [spot({ filled: 1, pendingAuto: 0 })], clubPayoutReady: false })
    expect(keys([ready])).toContain('not-payable')
  })

  it('varsler ikke når klubben er klar', () => {
    const ready = show({ requirements: [spot({ filled: 1, pendingAuto: 0 })] })
    expect(keys([ready])).not.toContain('not-payable')
  })

  // Showet publiserer seg ikke selv lenger. En full lineup som står upublisert
  // selger ingen billetter, og e-posten til klubben kan bli liggende.
  it('minner om publisering når lineupen er full og klubben er klar', () => {
    const ready = show({ status: 'fullbooked', requirements: [spot({ filled: 1, pendingAuto: 0 })] })
    expect(keys([ready])).toContain('ready-to-publish')

    const blocked = show({ status: 'fullbooked', requirements: [spot({ filled: 1, pendingAuto: 0 })], clubPayoutReady: false })
    expect(keys([blocked])).not.toContain('ready-to-publish')
  })

  it('minner ikke om publisering når showet er publisert eller har en ledig plass', () => {
    const live = show({ status: 'published', requirements: [spot({ filled: 1, pendingAuto: 0 })] })
    expect(keys([live])).not.toContain('ready-to-publish')
    expect(keys([show()])).not.toContain('ready-to-publish')
  })

  // Et show uten plasser har ikke «full lineup» — det kan ikke publiseres i
  // det hele tatt. Varselet sa det motsatte, og uten Stripe-mangel sa det
  // ingenting, så showet sto fast uten et ord.
  it('sier at et show uten plasser mangler en lineup, ikke at den er full', () => {
    const empty = show({ requirements: [], clubPayoutReady: false })
    expect(keys([empty])).toContain('no-spots')
    expect(keys([empty])).not.toContain('not-payable')

    expect(keys([show({ requirements: [] })])).toContain('no-spots')
  })
})

// Et manuelt tilbud tar showet ut av utkast uten å starte bølgene. Showet ser
// i gang ut, mens motoren ikke rører en eneste plass — og ingenting sa fra
// før fristen nærmet seg.
describe('bookingen er ikke startet', () => {
  it('varsler når ingen av plassene er med i bookingen', () => {
    const idle = show({ requirements: [spot({ autoStarted: false, pendingAuto: 0 })] })
    expect(keys([idle])).toContain('not-started')
  })

  it('varsler når bare noen av plassene er med', () => {
    const half = show({
      requirements: [spot({ id: 'a' }), spot({ id: 'b', autoStarted: false, pendingAuto: 0 })],
    })
    const alert = run([half]).find((row) => row.id.endsWith('not-started'))
    expect(alert?.message).toContain('1 plass er')
  })

  it('varsler ikke om en plass som er åpen for søknader', () => {
    const open = show({ requirements: [spot({ autoStarted: false, submissionsOpen: true, pendingAuto: 0 })] })
    expect(keys([open])).not.toContain('not-started')
  })

  it('varsler ikke når lineupen er full', () => {
    const full = show({ requirements: [spot({ autoStarted: false, filled: 1, pendingAuto: 0 })] })
    expect(keys([full])).not.toContain('not-started')
  })
})

describe('bookerens eget tilbud', () => {
  it('varsler når det har holdt plassen i mer enn tre døgn', () => {
    const waiting = show({
      requirements: [spot({ pendingAuto: 0, pendingManual: 1, oldestManualOfferAt: '2026-02-24T09:00:00Z' })],
    })
    expect(keys([waiting])).toContain('manual-wait-spot-1')
  })

  it('varsler ikke med en gang', () => {
    const waiting = show({
      requirements: [spot({ pendingAuto: 0, pendingManual: 1, oldestManualOfferAt: '2026-02-28T09:00:00Z' })],
    })
    expect(keys([waiting])).not.toContain('manual-wait-spot-1')
  })
})

describe('mange nei', () => {
  it('varsler fra det tredje neiet', () => {
    expect(keys([show({ requirements: [spot({ declined: 3 })] })])).toContain('declines-spot-1')
  })

  it('varsler ikke på to', () => {
    expect(keys([show({ requirements: [spot({ declined: 2 })] })])).not.toContain('declines-spot-1')
  })
})

describe('oppfølging', () => {
  it('varsler om søknader som venter', () => {
    expect(keys([show({ pendingSubmissions: 2 })])).toContain('submissions')
  })

  it('varsler om et spilt show som ikke er vurdert', () => {
    expect(keys([show({ date: '2026-02-20', unreviewedSpots: 3 })])).toContain('unreviewed')
  })

  it('varsler ikke om et spilt show som er vurdert', () => {
    expect(keys([show({ date: '2026-02-20', unreviewedSpots: 0 })])).toEqual([])
  })

  it('tier om alt annet på et spilt show — plassene kan ikke fylles lenger', () => {
    const played = show({
      date: '2026-02-20',
      unreviewedSpots: 0,
      requirements: [spot({ matching: 0, available: 0, pendingAuto: 0 })],
      pendingSubmissions: 2,
    })
    expect(keys([played])).toEqual([])
  })
})

describe('rekkefølgen', () => {
  it('setter det som haster mest øverst, og av det kvelden som kommer først', () => {
    const alerts = run([
      show({ id: 'later', date: '2026-04-10', pendingSubmissions: 1 }),
      show({ id: 'soon', date: '2026-03-05' }),
      show({ id: 'mid', date: '2026-03-17' }),
    ])

    expect(alerts[0].level).toBe('critical')
    expect(alerts[0].showId).toBe('soon')
    expect(alerts.at(-1)?.level).toBe('followup')
  })

  it('gir hver rad en stabil nøkkel', () => {
    const ids = run([show({ pendingSubmissions: 1, requirements: [spot({ declined: 4 })] })]).map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('er tom når ingenting trenger oppmerksomhet', () => {
    expect(run([show({ date: '2026-06-01' })])).toEqual([])
  })
})
