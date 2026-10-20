'use client'

import { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Link2, MicVocal, Plus, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { FIELD_GROUP_CLASS, FIELD_INPUT_CLASS, FieldFrame, FieldSection } from '@/components/admin/form-fields'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  disconnectComedianAction,
  linkComedianAction,
  type ComedianLinkFormState,
} from '@/app/admin-app/(protected)/my-club/comedian-actions'

export type LinkedComedian = {
  name: string
  email: string
  /** E-posten til komikerens egen (sperrede) innlogging, når profilen ble koblet fra en. */
  ownLoginEmail: string | null
}

/**
 * «Do you also perform?» under My club.
 *
 * Gjelder innloggingen som ser på siden, ikke klubben: en medadmin i samme
 * klubb ser sitt eget kort. Se `lib/comedian-link.ts`.
 */
export function ComedianProfileLink({ comedian }: { comedian: LinkedComedian | null }) {
  return (
    <FieldFrame>
      <FieldSection id="comedian-profile" title="Comedian profile">
        <div className="col-span-12">
          {comedian ? <Connected comedian={comedian} /> : <NotConnected />}
        </div>
      </FieldSection>
    </FieldFrame>
  )
}

function useToastState(state: ComedianLinkFormState) {
  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.success)
  }, [state])
}

function NotConnected() {
  const [showLogin, setShowLogin] = useState(false)
  const [state, formAction, pending] = useActionState<ComedianLinkFormState, FormData>(linkComedianAction, {})
  useToastState(state)

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-content-center rounded-xl bg-muted/60 text-muted-foreground">
          <MicVocal className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium leading-snug">Do you also perform?</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Connect a comedian profile to this login and switch between club and comedian without logging out.
            It is yours only — other admins of the club don&apos;t see it.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href="/admin-app/my-club/comedian/new">
            <Plus data-icon="inline-start" />
            Create comedian profile
          </Link>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={showLogin}
          onClick={() => setShowLogin((value) => !value)}
        >
          <Link2 data-icon="inline-start" />
          I already have a comedian account
        </Button>
      </div>

      {showLogin ? (
        <form action={formAction} className="grid grid-cols-12 gap-x-3 gap-y-4 rounded-xl border bg-muted/30 p-4">
          <p className="col-span-12 text-xs leading-relaxed text-muted-foreground">
            Sign in with the comedian account to prove it&apos;s yours. Its profile moves to this login, and the old
            comedian login stops working until you disconnect. Booking offers keep going to the same email.
          </p>
          <Field className="col-span-12 min-w-0 gap-1.5 @xl:col-span-6">
            <FieldLabel htmlFor="comedian-email">Comedian account email</FieldLabel>
            <div className={FIELD_GROUP_CLASS}>
              <Input
                id="comedian-email"
                name="email"
                type="email"
                autoComplete="off"
                required
                className={FIELD_INPUT_CLASS}
              />
            </div>
          </Field>
          <Field className="col-span-12 min-w-0 gap-1.5 @xl:col-span-6">
            <FieldLabel htmlFor="comedian-password">Password</FieldLabel>
            <div className={FIELD_GROUP_CLASS}>
              <Input
                id="comedian-password"
                name="password"
                type="password"
                autoComplete="off"
                required
                className={FIELD_INPUT_CLASS}
              />
            </div>
          </Field>
          <div className="col-span-12">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Connecting…' : 'Connect comedian account'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}

function Connected({ comedian }: { comedian: LinkedComedian }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<ComedianLinkFormState, FormData>(disconnectComedianAction, {})
  useToastState(state)
  // Etter en vellykket frakobling tegnes siden på nytt uten koblingen, og
  // dette kortet (med dialogen) byttes ut med «Do you also perform?».

  const createdHere = !comedian.ownLoginEmail

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-content-center rounded-xl bg-muted/60 text-muted-foreground">
          <MicVocal className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium leading-snug">Connected to {comedian.name}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Use “Switch to comedian” in the menu. One login for both: logging out signs you out of club and comedian.
            Offers go to {comedian.email}.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href="/artist-app">
            Open comedian portal
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>

        <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
          <DialogTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="text-muted-foreground">
              <Unlink data-icon="inline-start" />
              Disconnect
            </Button>
          </DialogTrigger>
          <DialogContent lang="en" className="sm:max-w-md">
            <form action={formAction} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Disconnect {comedian.name}?</DialogTitle>
                <DialogDescription>
                  {createdHere
                    ? 'The comedian profile gets its own login, and this login goes back to club only. Bookings, availability and payouts stay with the profile.'
                    : `The profile goes back to ${comedian.ownLoginEmail}, which works again with its old password. This login goes back to club only. Bookings, availability and payouts stay with the profile.`}
                </DialogDescription>
              </DialogHeader>

              {createdHere ? (
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="comedian-login-email">Email for the comedian login</FieldLabel>
                  <div className={FIELD_GROUP_CLASS}>
                    <Input
                      id="comedian-login-email"
                      name="email"
                      type="email"
                      autoComplete="off"
                      required
                      className={FIELD_INPUT_CLASS}
                    />
                  </div>
                  <FieldDescription className="text-xs">
                    Not the email you use for the club. We send a link there to set a password, and booking offers go
                    there from now on.
                  </FieldDescription>
                </Field>
              ) : null}

              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={pending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" variant="destructive" disabled={pending}>
                  {pending ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
