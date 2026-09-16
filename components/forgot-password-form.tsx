"use client"

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type ForgotPasswordFormProps = {
  callbackPath: string
  resetPath: string
  loginPath: string
}

export function ForgotPasswordForm({ callbackPath, resetPath, loginPath }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setError(null)

    const redirectUrl = new URL(callbackPath, window.location.origin)
    redirectUrl.searchParams.set('next', resetPath)
    const supabase = createClient()
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: redirectUrl.toString(),
    })

    setIsSubmitting(false)
    if (resetError) {
      setError('We could not send the reset email. Please try again.')
      return
    }

    setSubmitted(true)
  }

  return (
    <div className="w-full max-w-sm rounded-[var(--ev-r-card)] bg-[var(--ev-card)] p-6 text-[var(--ev-text)] shadow-sm">
      <h1 className="text-[1.35rem] font-semibold tracking-[-0.02em]">Reset your password</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-[var(--ev-muted)]">
        Enter your email and we will send you a secure password-reset link.
      </p>

      {submitted ? (
        <div className="mt-6 space-y-4">
          <p className="rounded-xl bg-[var(--ev-bg)] px-3 py-2 text-[14px] leading-relaxed ring-1 ring-inset ring-[var(--ev-line)]">
            If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.
          </p>
          <Link href={loginPath} className="block text-center text-[13px] font-medium text-[var(--ev-accent)] underline underline-offset-4">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label htmlFor="reset-email" className="block text-[13px] font-medium">Email</label>
          <Input
            id="reset-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-11 rounded-xl border-0 bg-[var(--ev-bg)] text-[14px] ring-1 ring-inset ring-[var(--ev-line)] focus-visible:ring-2 focus-visible:ring-[var(--ev-accent-fill)]"
          />
          {error && <p className="text-[13px] text-[var(--ev-accent)]">{error}</p>}
          <Button type="submit" disabled={isSubmitting} className="h-11 w-full rounded-full bg-[var(--ev-text)] text-[13px] font-semibold text-[var(--ev-bg)] hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]">
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>
          <Link href={loginPath} className="block text-center text-[13px] font-medium text-[var(--ev-accent)] underline underline-offset-4">
            Back to sign in
          </Link>
        </form>
      )}
    </div>
  )
}