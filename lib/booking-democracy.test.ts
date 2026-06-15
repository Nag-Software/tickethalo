import { describe, expect, it } from 'vitest'
import {
  assertCorrectBookings,
  assertDemocraticDistribution,
  generateDemocracyScenarios,
  runScenario,
  type DemocracyScenario,
} from './booking-democracy-helpers'

const scenarios = generateDemocracyScenarios()

describe('demokratisk autobooking — 100 scenarier med 50+ komikere', () => {
  it.each(scenarios)('scenario $id: $name', (scenario: DemocracyScenario) => {
    expect(scenario.rosterSize).toBeGreaterThanOrEqual(50)

    const { roster, requirements, result } = runScenario(scenario)

    assertCorrectBookings(roster, requirements, result.showWinners)
    assertDemocraticDistribution(result, scenario.rosterSize, scenario.numShows)
  })
})

describe('demokratisk autobooking — oppsummering', () => {
  it('alle 100 scenarier har minst 50 komikere', () => {
    for (const s of scenarios) {
      expect(s.rosterSize).toBeGreaterThanOrEqual(50)
    }
    expect(scenarios).toHaveLength(100)
  })

  it('scenarioene dekker ulike parametre', () => {
    const presets = new Set(scenarios.map(s => s.preset))
    const lineups = new Set(scenarios.map(s => s.lineup))
    const sizes = new Set(scenarios.map(s => s.rosterSize))

    expect(presets).toEqual(new Set(['mild', 'normal', 'strict']))
    expect(lineups.size).toBeGreaterThanOrEqual(4)
    expect(sizes.size).toBeGreaterThanOrEqual(20)
  })

  it('diagnostikk: vurderer om humorevents er demokratisk nok (87+ av 100)', () => {
    type ScenarioReport = {
      id: number
      lineup: string
      preset: string
      rosterSize: number
      numShows: number
      uniqueWinners: number
      maxBookings: number
      totalSpots: number
      maxSharePct: number
      dominanceRatio: number
      gini: number
      passed: boolean
      failure?: string
    }

    const reports: ScenarioReport[] = []

    for (const scenario of scenarios) {
      const { roster, requirements, result } = runScenario(scenario)
      let passed = true
      let failure: string | undefined

      try {
        assertCorrectBookings(roster, requirements, result.showWinners)
      }
      catch (e) {
        passed = false
        failure = e instanceof Error ? e.message : 'korrekt booking feilet'
      }

      if (passed) {
        try {
          assertDemocraticDistribution(result, scenario.rosterSize, scenario.numShows)
        }
        catch (e) {
          passed = false
          failure = e instanceof Error ? e.message : 'demokratisk fordeling feilet'
        }
      }

      reports.push({
        id: scenario.id,
        lineup: scenario.lineup,
        preset: scenario.preset,
        rosterSize: scenario.rosterSize,
        numShows: scenario.numShows,
        uniqueWinners: result.uniqueWinners,
        maxBookings: result.maxBookingsPerArtist,
        totalSpots: result.totalSpots,
        maxSharePct: result.totalSpots > 0
          ? Math.round((result.maxBookingsPerArtist / result.totalSpots) * 100)
          : 0,
        dominanceRatio: Math.round(result.dominanceRatio * 100) / 100,
        gini: Math.round(result.giniCoefficient * 100) / 100,
        passed,
        failure,
      })
    }

    const passedCount = reports.filter(r => r.passed).length
    const failed = reports.filter(r => !r.passed)

    const failuresByLineup = Object.groupBy(failed, r => r.lineup)
    const failuresByPreset = Object.groupBy(failed, r => r.preset)

    expect(
      passedCount,
      [
        `Demokratisk score: ${passedCount}/100 scenarier bestått.`,
        `Feilet lineup: ${JSON.stringify(Object.fromEntries(Object.entries(failuresByLineup).map(([k, v]) => [k, v?.length ?? 0])))}`,
        `Feilet preset: ${JSON.stringify(Object.fromEntries(Object.entries(failuresByPreset).map(([k, v]) => [k, v?.length ?? 0])))}`,
        `Verste: ${failed.sort((a, b) => b.maxSharePct - a.maxSharePct).slice(0, 5).map(r => `#${r.id} ${r.maxSharePct}% (${r.maxBookings}/${r.totalSpots})`).join(', ')}`,
      ].join('\n'),
    ).toBeGreaterThanOrEqual(90)
  })
})
