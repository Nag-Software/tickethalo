import { describe, expect, it } from 'vitest'
import { describeSetupGuide } from '@/lib/setup-guide'

const readyClub = {
  logo_url: 'https://cdn/logo.png',
  description: 'Stand-up every Thursday',
  stripe_account_id: 'acct_1',
  charges_enabled: true,
  payouts_enabled: true,
  payout_schedule_interval: 'manual',
  legal_name: 'Comedy Club AS',
  org_number: '999999999',
  support_email: 'club@example.com',
}

describe('describeSetupGuide', () => {
  it('starts with nothing done for a brand-new club', () => {
    const guide = describeSetupGuide({
      club: { ...readyClub, logo_url: null, description: null, stripe_account_id: null, charges_enabled: false, payouts_enabled: false, payout_schedule_interval: null, legal_name: null, org_number: null, support_email: null },
      showCount: 0,
      publishedCount: 0,
    })
    expect(guide.doneCount).toBe(0)
    expect(guide.complete).toBe(false)
    expect(guide.next?.key).toBe('profile')
  })

  it('checks each point off from real state, in order', () => {
    const guide = describeSetupGuide({ club: readyClub, showCount: 1, publishedCount: 0 })
    expect(guide.steps.map((step) => [step.key, step.done])).toEqual([
      ['profile', true],
      ['payouts', true],
      ['show', true],
      ['publish', false],
    ])
    expect(guide.next?.key).toBe('publish')
  })

  it('needs both a logo and a description for the profile point', () => {
    expect(describeSetupGuide({ club: { ...readyClub, description: '  ' }, showCount: 0, publishedCount: 0 }).steps[0].done).toBe(false)
    expect(describeSetupGuide({ club: { ...readyClub, logo_url: null }, showCount: 0, publishedCount: 0 }).steps[0].done).toBe(false)
  })

  it('ties payouts to the Stripe setup being fully ready', () => {
    const guide = describeSetupGuide({ club: { ...readyClub, payouts_enabled: false }, showCount: 0, publishedCount: 0 })
    expect(guide.steps[1].done).toBe(false)
    expect(guide.next?.key).toBe('payouts')
  })

  it('is complete once a show is published', () => {
    const guide = describeSetupGuide({ club: readyClub, showCount: 2, publishedCount: 1 })
    expect(guide).toMatchObject({ doneCount: 4, complete: true, next: null })
  })
})
