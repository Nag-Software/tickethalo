import { describe, expect, it } from 'vitest'
import { getOpenAI } from '@/lib/openai'
import { stripe } from '@/lib/stripe'

describe('live provider smoke tests', () => {
  it.skipIf(!process.env.OPENAI_API_KEY)('authenticates with OpenAI without generating billable content', async () => {
    const page = await getOpenAI().models.list()
    expect(page.data.length).toBeGreaterThan(0)
  })

  it.skipIf(!process.env.STRIPE_SECRET_KEY)('uses a Stripe test key and can read the platform balance', async () => {
    expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/)
    const balance = await stripe.balance.retrieve()
    expect(balance.object).toBe('balance')
  })
})
