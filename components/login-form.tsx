"use client"

import { useEffect } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function LoginForm({
  className,
  title = "Login to your account",
  description = "Enter your email below to login to your account",
  action = "#",
  errorMessage,
  brandLabel,
  brandHref = '/',
  showSignupLink = true,
  signupHref = '/artist-app/signup',
  signupLabel = 'Sign up here',
  signupPrompt = 'New here?',
  submitLabel = 'Sign in',
  submitClassName,
  nextPath,
  theme = 'default',
  ...props
}: React.ComponentProps<"div"> & {
  title?: string
  description?: string
  action?: string
  errorMessage?: string
  brandLabel?: string
  brandHref?: string
  showSignupLink?: boolean
  signupHref?: string
  signupLabel?: string
  signupPrompt?: string
  submitLabel?: string
  /** Extra classes on the submit button — the club portal signs in on a violet CTA. */
  submitClassName?: string
  nextPath?: string
  /** 'portal' bruker .ev-surface-tokens, slik at kortet hører hjemme på cream-bunnen. */
  theme?: 'default' | 'poster' | 'portal'
}) {
  useEffect(() => {
    if (errorMessage) toast.error(errorMessage)
  }, [errorMessage])

  const isPoster = theme === 'poster'
  const isPortal = theme === 'portal'

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className={cn(
        'shadow-sm',
        isPoster && 'rounded-none border-2 border-zinc-950 bg-[#fbf7ec] shadow-[8px_8px_0_rgba(24,24,27,0.14)]',
        isPortal && 'rounded-[var(--ev-r-card)] border-0 bg-[var(--ev-card)] text-[var(--ev-text)] shadow-none',
        !isPoster && !isPortal && 'rounded-lg',
      )}>
        <CardHeader className={cn('space-y-0', isPoster && 'border-b-2 border-zinc-950 px-6 py-5')}>
          {brandLabel && (
            <Link href={brandHref} className={cn(
              'mb-3 mx-auto inline-flex text-sm font-bold',
              isPoster
                ? 'border border-zinc-950 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-zinc-950'
                : isPortal
                  ? 'rounded-full bg-[var(--ev-bg)] px-3 py-1 text-[12px] font-semibold text-[var(--ev-muted)]'
                  : 'rounded-full bg-amber-100 px-2.5 py-1 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
            )}>
              {brandLabel}
            </Link>
          )}
          <CardTitle className={cn(
            isPoster && 'text-2xl font-black uppercase tracking-tight',
            isPortal && 'text-[1.25rem] font-semibold tracking-[-0.02em]',
          )}>{title}</CardTitle>
          <CardDescription className={cn(
            isPoster && 'mt-1 text-sm font-medium text-zinc-600',
            isPortal && 'mt-1 text-[14px] text-[var(--ev-muted)]',
          )}>{description}</CardDescription>
        </CardHeader>
        <CardContent className={cn(isPoster && 'p-5')}>
          <form action={action} method="post">
            <FieldGroup>
              {nextPath && <input type="hidden" name="next" value={nextPath} />}
              {errorMessage && (
                <div className={cn(
                  'px-3 py-2 text-sm',
                  isPoster
                    ? 'border-2 border-[#b83224] bg-white text-[#b83224]'
                    : isPortal
                      ? 'rounded-xl bg-[var(--ev-bg)] text-[var(--ev-accent)] ring-1 ring-inset ring-[var(--ev-accent)]/30'
                      : 'rounded-md bg-destructive/10 text-destructive',
                )}>
                  {errorMessage}
                </div>
              )}
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className={cn(
                    isPoster && 'h-11 rounded-none border-2 border-zinc-950 bg-white/70',
                    isPortal && 'h-11 rounded-xl border-0 bg-[var(--ev-bg)] text-[14px] ring-1 ring-inset ring-[var(--ev-line)] focus-visible:ring-2 focus-visible:ring-[var(--ev-accent-fill)]',
                  )}
                />
              </Field>
              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className={cn(
                    isPoster && 'h-11 rounded-none border-2 border-zinc-950 bg-white/70',
                    isPortal && 'h-11 rounded-xl border-0 bg-[var(--ev-bg)] text-[14px] ring-1 ring-inset ring-[var(--ev-line)] focus-visible:ring-2 focus-visible:ring-[var(--ev-accent-fill)]',
                  )}
                />
              </Field>
              <Field>
                <Button
                  type="submit"
                  className={cn(
                    isPoster && 'h-11 w-full rounded-none border-2 border-zinc-950 bg-[#b83224] font-bold text-white shadow-[4px_4px_0_#18181b] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:bg-[#9f2d21] hover:shadow-[2px_2px_0_#18181b]',
                    isPortal && 'h-11 w-full rounded-full border-0 bg-[var(--ev-text)] text-[13px] font-semibold text-[var(--ev-bg)] hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]',
                    submitClassName,
                  )}
                >
                  {submitLabel}
                </Button>
                {showSignupLink && (
                  <FieldDescription className={cn(
                    'text-center',
                    isPoster && 'pt-2 text-sm font-medium text-zinc-600',
                    isPortal && 'pt-1 text-[13px] text-[var(--ev-muted)]',
                  )}>
                    {signupPrompt}{' '}
                    <Link href={signupHref} className={cn(
                      isPoster && 'font-bold underline decoration-2 underline-offset-4 hover:text-[#b83224]',
                      isPortal && 'font-medium text-[var(--ev-accent)] underline underline-offset-4',
                    )}>
                      {signupLabel}
                    </Link>
                  </FieldDescription>
                )}
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
