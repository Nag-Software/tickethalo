"use client"

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type ResetPasswordFormProps = {
  loginPath: string
}

export function ResetPasswordForm({ loginPath }: ResetPasswordFormProps) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Use at least 8 characters for your new password.')
      return
    }
    if (password !== confirmation) {
      setError('The passwords do not match.')
      return
    }

    setIsSubmitting(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setIsSubmitting(false)
      setError('We could not update your password. Please request a new reset link.')
      return
    }

    await supabase.auth.signOut()
    router.replace(`${loginPath}?reset=success`)
  }

  return (
    <div className="w-full max-w-sm rounded-[var(--ev-r-card)] bg-[var(--ev-card)] p-6 text-[var(--ev-text)] shadow-sm">
      <h1 className="text-[1.35rem] font-semibold tracking-[-0.02em]">Choose a new password</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-[var(--ev-muted)]">Use a password you do not use elsewhere.</p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="new-password" className="block text-[13px] font-medium">New password</label>
          <Input id="new-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-11 rounded-xl border-0 bg-[var(--ev-bg)] text-[14px] ring-1 ring-inset ring-[var(--ev-line)] focus-visible:ring-2 focus-visible:ring-[var(--ev-accent-fill)]" />
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-[13px] font-medium">Confirm password</label>
          <Input id="confirm-password" type="password" autoComplete="new-password" required minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-2 h-11 rounded-xl border-0 bg-[var(--ev-bg)] text-[14px] ring-1 ring-inset ring-[var(--ev-line)] focus-visible:ring-2 focus-visible:ring-[var(--ev-accent-fill)]" />
        </div>
        {error && <p className="text-[13px] text-[var(--ev-accent)]">{error}</p>}
        <Button type="submit" disabled={isSubmitting} className="h-11 w-full rounded-full bg-[var(--ev-text)] text-[13px] font-semibold text-[var(--ev-bg)] hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]">
          {isSubmitting ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </div>
  )
}