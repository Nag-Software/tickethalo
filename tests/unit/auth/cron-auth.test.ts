// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'

function cronRequest(authorization?: string) {
  return new Request('https://tickethalo.test/api/cron/stripe-fees', {
    headers: authorization === undefined ? {} : { authorization },
  })
}

describe('isAuthorizedCronRequest', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accepts the exact bearer secret', () => {
    vi.stubEnv('CRON_SECRET', 's3cret-value')
    expect(isAuthorizedCronRequest(cronRequest('Bearer s3cret-value'))).toBe(true)
  })

  it.each([
    ['a wrong secret', 'Bearer wrong'],
    ['a secret with a different length', 'Bearer s3cret-value-and-more'],
    ['the secret without the Bearer prefix', 's3cret-value'],
    ['a different casing', 'bearer s3cret-value'],
    ['an empty header', ''],
  ])('rejects %s', (_label, header) => {
    vi.stubEnv('CRON_SECRET', 's3cret-value')
    expect(isAuthorizedCronRequest(cronRequest(header))).toBe(false)
  })

  it('rejects a request without authorization header', () => {
    vi.stubEnv('CRON_SECRET', 's3cret-value')
    expect(isAuthorizedCronRequest(cronRequest())).toBe(false)
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('rejects everything when CRON_SECRET is %s', (_label, secret) => {
    vi.stubEnv('CRON_SECRET', secret)
    expect(isAuthorizedCronRequest(cronRequest('Bearer undefined'))).toBe(false)
    expect(isAuthorizedCronRequest(cronRequest('Bearer '))).toBe(false)
    expect(isAuthorizedCronRequest(cronRequest(`Bearer ${secret ?? ''}`))).toBe(false)
  })
})
