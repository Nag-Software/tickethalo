// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(async () => ({ error: null })),
  verifyOtp: vi.fn(async () => ({ error: null })),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth }) }))

import { handleAuthCallback } from '@/lib/auth-callback'

beforeEach(() => {
  auth.exchangeCodeForSession.mockClear()
  auth.verifyOtp.mockClear()
})

describe('handleAuthCallback', () => {
  it('verifies a token hash from our own welcome email and lands on the reset page', async () => {
    const response = await handleAuthCallback(
      new Request('https://app.test/admin-app/auth/callback?token_hash=h1&type=recovery&next=/admin-app/reset-password'),
      '/admin-app',
    )
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'h1' })
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBe('https://app.test/admin-app/reset-password')
  })

  it('still exchanges a PKCE code from the forgot-password flow', async () => {
    const response = await handleAuthCallback(new Request('https://app.test/admin-app/auth/callback?code=c1'), '/admin-app')
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('c1')
    expect(response.headers.get('location')).toBe('https://app.test/admin-app/reset-password')
  })

  it('refuses an unknown token type and a link with nothing to verify', async () => {
    const bad = await handleAuthCallback(new Request('https://app.test/admin-app/auth/callback?token_hash=h1&type=signup'), '/admin-app')
    expect(bad.headers.get('location')).toBe('https://app.test/admin-app/forgot-password?error=callback')
    expect(auth.verifyOtp).not.toHaveBeenCalled()

    const empty = await handleAuthCallback(new Request('https://app.test/admin-app/auth/callback'), '/admin-app')
    expect(empty.headers.get('location')).toBe('https://app.test/admin-app/forgot-password?error=callback')
  })
})
