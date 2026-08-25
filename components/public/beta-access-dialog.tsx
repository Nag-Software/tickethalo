'use client'

import * as React from 'react'
import { ArrowRight, Check } from 'lucide-react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { requestClubBetaAccessAction } from '@/app/actions/beta-access'

const FIELD =
  'h-11 w-full rounded-xl bg-[var(--ev-card)] px-3.5 text-[16px] text-[var(--ev-text)] outline-none ring-1 ring-inset ring-[var(--ev-line)] transition-[box-shadow] placeholder:text-[var(--ev-faint)] focus:ring-2 focus:ring-[var(--ev-accent-fill)] sm:text-[14px]'

const LABEL = 'text-[13px] font-medium text-[var(--ev-muted)]'

/**
 * «Request beta access» from the comedy club portal. Clubs cannot register
 * themselves during the beta, so the form only collects who is asking — the
 * request lands in /superadmin/beta-requests and a human takes it from there.
 *
 * The trigger is built here, from `className` and `label`, rather than passed
 * in as children: Radix' `asChild` clones the child element, and an element
 * created by the server page renders to nothing in that slot during SSR —
 * the button then only appeared after hydration, and mismatched.
 */
export function BetaAccessDialog({
  source,
  className,
  label = 'Request beta access',
  withArrow = false,
}: {
  /** Which CTA opened the dialog — stored with the request. */
  source: string
  /** Styling for the trigger; each CTA on the page looks different. */
  className?: string
  label?: string
  withArrow?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [sent, setSent] = React.useState<{ clubName: string; email: string } | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setError(null)

    startTransition(async () => {
      const result = await requestClubBetaAccessAction(formData)
      if ('error' in result) {
        setError(result.error)
        return
      }
      setSent({
        clubName: String(formData.get('club_name') ?? '').trim(),
        // Lowercased the same way the action stores it, so the receipt shows
        // the address we will actually write to.
        email: String(formData.get('email') ?? '').trim().toLowerCase(),
      })
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Reset only once the dialog is fully closed — clearing on open would
        // wipe the receipt while it is still fading out.
        if (!next) {
          setError(null)
          setSent(null)
        }
      }}
    >
      <DialogTrigger className={className}>
        {label}
        {withArrow && <ArrowRight className="size-4" aria-hidden />}
      </DialogTrigger>

      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-[1.25rem] bg-[var(--ev-bg)] p-0 text-[var(--ev-text)]">
        {sent ? (
          <div className="px-6 py-9 text-center sm:px-8">
            <span
              aria-hidden
              className="mx-auto grid size-11 place-content-center rounded-full bg-[var(--ev-accent-fill)] text-[var(--ev-accent-ink)]"
            >
              <Check className="size-5" strokeWidth={2.5} />
            </span>
            <DialogTitle className="mt-4 text-[1.25rem] font-semibold tracking-[-0.02em] text-[var(--ev-text)]">
              You&rsquo;re on the list
            </DialogTitle>
            <DialogDescription className="mt-2 text-[14px] leading-relaxed text-[var(--ev-muted)]">
              We&rsquo;ll email <span className="font-medium text-[var(--ev-text)]">{sent.email}</span>{' '}
              about {sent.clubName} as soon as we open a spot in the beta.
            </DialogDescription>
            <DialogClose className="ev-hero-cta mt-6 w-full bg-[var(--ev-text)] text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]">
              Close
            </DialogClose>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-7 sm:px-8">
            <DialogHeader className="gap-2 text-left">
              <DialogTitle className="text-[1.35rem] font-semibold tracking-[-0.025em] text-[var(--ev-text)]">
                Request beta access
              </DialogTitle>
              <DialogDescription className="text-[14px] leading-relaxed text-[var(--ev-muted)]">
                The comedy club portal is invite only while we&rsquo;re in beta. Tell us who you are,
                and we&rsquo;ll get back to you with an invitation.
              </DialogDescription>
            </DialogHeader>

            <fieldset disabled={isPending} className="mt-6 flex flex-col gap-4 disabled:opacity-70">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="beta-club-name" className={LABEL}>
                  Club name
                </label>
                {/* 16px on mobile is not decoration: anything smaller makes iOS
                    Safari zoom into the field on focus. */}
                <input
                  id="beta-club-name"
                  name="club_name"
                  type="text"
                  required
                  maxLength={120}
                  autoComplete="organization"
                  placeholder="Crønch Comedy Club"
                  className={FIELD}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="beta-email" className={LABEL}>
                  Email
                </label>
                <input
                  id="beta-email"
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  placeholder="you@yourclub.com"
                  className={FIELD}
                />
              </div>

              <input type="hidden" name="source" value={source} />

              {error && (
                <p
                  role="alert"
                  className="rounded-xl bg-[var(--ev-card)] px-3.5 py-2.5 text-[13px] text-[var(--ev-accent)] ring-1 ring-inset ring-[var(--ev-accent)]/30"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                className="ev-hero-cta mt-1 w-full bg-[var(--ev-text)] text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
              >
                {isPending ? 'Sending…' : (
                  <>
                    Request access <ArrowRight className="ml-1.5 size-4" aria-hidden />
                  </>
                )}
              </button>

              <p className="text-center text-[12px] text-[var(--ev-faint)]">
                We only use this to contact you about the beta.
              </p>
            </fieldset>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
