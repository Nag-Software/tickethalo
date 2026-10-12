import Link from 'next/link'
import { ArrowRight, ArrowUpRight, Check, CircleAlert, ExternalLink, Loader2 } from 'lucide-react'
import { PendingButton } from '@/components/pending-button'
import { ToastActionForm } from '@/components/toast-action-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ClubSetup, SetupStep } from '@/lib/club-setup'
import { orgNumberFieldLabel, orgNumberPlaceholder } from '@/lib/org-number'
import type { ConnectClub } from '@/lib/stripe-connect'
import { openClubDashboardAction, saveSellerSetupAction, startClubOnboardingAction } from './actions'

/**
 * Oppsettet for å selge billetter, ett steg om gangen.
 *
 * Før var dette ett kort med seks sjekkpunkter, en Stripe-knapp som var grå
 * til et felt i et annet kort var fylt ut, og en Refresh-knapp. Klubben måtte
 * finne rekkefølgen selv. Nå viser kortet bare steget klubben står på
 * (`describeClubSetup`), med én knapp. Statusen hos Stripe hentes hver gang
 * siden åpnes mens steg 2 pågår, så ingen trenger å trykke Refresh.
 */

const STEPS: Array<{ key: SetupStep; label: string }> = [
  { key: 'seller', label: 'Seller' },
  { key: 'stripe', label: 'Stripe' },
  { key: 'ready', label: 'Ready' },
]

function Steps({ current }: { current: SetupStep }) {
  const currentIndex = STEPS.findIndex((step) => step.key === current)
  return (
    <ol className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
      {STEPS.map((step, index) => {
        const done = index < currentIndex || current === 'ready'
        const active = index === currentIndex
        return (
          <li key={step.key} className="flex items-center gap-3">
            {index > 0 && <span aria-hidden className="h-px w-8 bg-border" />}
            <span className={`flex items-center gap-2 ${active || done ? 'text-foreground' : ''}`}>
              <span
                aria-hidden
                className={`inline-flex size-6 items-center justify-center rounded-full text-[11px] ${
                  done ? 'bg-emerald-600 text-white' : active ? 'bg-foreground text-background' : 'border'
                }`}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
              {step.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function SetupCard({ club, setup }: { club: ConnectClub; setup: ClubSetup }) {
  return (
    <Card size="sm">
      <CardHeader>
        <Steps current={setup.step} />
      </CardHeader>
      <CardContent>
        {setup.step === 'seller' && <SellerStep club={club} />}
        {setup.step === 'stripe' && !setup.stripe.hasAccount && <ConnectStep />}
        {setup.step === 'stripe' && setup.stripe.hasAccount && <StripeStatusStep setup={setup} />}
      </CardContent>
    </Card>
  )
}

/** Steg 1. Navn, foretaksnummer og kontakt — det som står på billetten. */
function SellerStep({ club }: { club: ConnectClub }) {
  return (
    <ToastActionForm action={saveSellerSetupAction} className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Who sells the tickets?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Printed on every ticket. Takes one minute.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="setup-legal-name">Legal name</Label>
          <Input id="setup-legal-name" name="legal_name" defaultValue={club.legal_name ?? ''} placeholder="Comedy Club Ltd" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-org-number">{orgNumberFieldLabel(club.country)}</Label>
          <Input
            id="setup-org-number"
            name="org_number"
            inputMode="numeric"
            defaultValue={club.org_number ?? ''}
            placeholder={orgNumberPlaceholder(club.country)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-support-email">Contact for ticket buyers</Label>
          <Input
            id="setup-support-email"
            name="support_email"
            type="email"
            defaultValue={club.support_email ?? ''}
            placeholder="tickets@comedyclub.com"
            required
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Shown as “Sold by” on tickets and receipts.</p>
        <PendingButton type="submit" pendingLabel="Saving…">
          Continue
          <ArrowRight data-icon="inline-end" />
        </PendingButton>
      </div>
    </ToastActionForm>
  )
}

/** Steg 2, før kontoen finnes. Én knapp; resten er tre linjer om hva klubben får. */
function ConnectStep() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Connect Stripe</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Stripe verifies the club and holds your bank details. About five minutes.
        </p>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {[
          'Ticket money goes straight to your own Stripe account',
          'Paid out to your bank after each show',
          'Have your registration number and bank account ready',
        ].map((line) => (
          <li key={line} className="flex items-center gap-2.5">
            <Check className="size-4 shrink-0 text-emerald-600" strokeWidth={2.5} />
            {line}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">You come straight back here when Stripe is done.</p>
        <ToastActionForm action={startClubOnboardingAction}>
          {/* Oppretter kontoen hos Stripe, laster opp logoen og henter
              onboarding-lenken: gjerne 5–10 sekunder før siden bytter. */}
          <PendingButton type="submit" pendingLabel="Connecting to Stripe…">
            Connect with Stripe
            <ArrowUpRight data-icon="inline-end" />
          </PendingButton>
        </ToastActionForm>
      </div>
    </div>
  )
}

/**
 * Steg 2, tilbake fra Stripe. Kontoen finnes; dette er det Stripe fortsatt
 * mangler. Utbetalingsplanen setter vi selv, så den vises som «på vei», ikke
 * som noe klubben skal gjøre.
 */
function StripeStatusStep({ setup }: { setup: ClubSetup }) {
  const { canTakePayments, hasBankAccount, payoutsHeld } = setup.stripe
  const stripeNeedsMore = !canTakePayments || !hasBankAccount

  const rows: Array<{ label: string; state: 'done' | 'missing' | 'pending' }> = [
    { label: 'Club verified — can take payments', state: canTakePayments ? 'done' : 'missing' },
    { label: 'Bank account for payouts', state: hasBankAccount ? 'done' : 'missing' },
    { label: 'Payouts held until after the show (set by Tickethalo)', state: payoutsHeld ? 'done' : 'pending' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Almost there</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {stripeNeedsMore ? 'Stripe has your club. Something is still missing.' : 'Stripe is done. We are finishing the last setting.'}
        </p>
      </div>
      <ul className="divide-y overflow-hidden rounded-xl border text-sm">
        {rows.map((row) => (
          <li
            key={row.label}
            className={`flex items-center gap-3 px-4 py-3 ${row.state === 'missing' ? 'bg-amber-50 font-medium dark:bg-amber-950/30' : 'text-muted-foreground'}`}
          >
            {row.state === 'done' && <Check className="size-4 shrink-0 text-emerald-600" strokeWidth={2.5} />}
            {row.state === 'missing' && <CircleAlert className="size-4 shrink-0 text-amber-700" strokeWidth={2.5} />}
            {row.state === 'pending' && <Loader2 className="size-4 shrink-0 animate-spin" />}
            {row.label}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">We check with Stripe every time you open this page.</p>
        <ToastActionForm action={startClubOnboardingAction}>
          <PendingButton type="submit" pendingLabel={stripeNeedsMore ? 'Opening Stripe…' : 'Checking…'}>
            {stripeNeedsMore ? 'Continue in Stripe' : 'Check again'}
            <ArrowUpRight data-icon="inline-end" />
          </PendingButton>
        </ToastActionForm>
      </div>
    </div>
  )
}

/** Steg 3. Alt er på plass: det som gjelder, og veien videre. */
export function ReadyCard({ club }: { club: ConnectClub }) {
  return (
    <Card size="sm" className="h-fit">
      <CardHeader>
        <span className="mb-1 inline-flex size-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">
          <Check className="size-5" strokeWidth={2.5} />
        </span>
        <CardTitle>Ready to sell</CardTitle>
        <CardDescription>
          Ticket money goes straight to your Stripe account and is paid out {club.payout_hold_days}{' '}
          {club.payout_hold_days === 1 ? 'day' : 'days'} after each show. Tickethalo only takes the commission.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col divide-y rounded-xl border text-sm">
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <dt className="text-muted-foreground">Sold by</dt>
            <dd className="truncate text-right font-medium">{club.legal_name}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <dt className="text-muted-foreground">Commission</dt>
            <dd className="font-medium">{club.platform_fee_bps / 100}% per ticket</dd>
          </div>
        </dl>
        <div className="flex flex-col gap-2">
          <Button asChild>
            <Link href="/admin-app/shows/new">
              Create a show
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          <ToastActionForm action={openClubDashboardAction}>
            <PendingButton type="submit" variant="outline" className="w-full" pendingLabel="Opening Stripe…">
              Open Stripe
              <ExternalLink data-icon="inline-end" />
            </PendingButton>
          </ToastActionForm>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          One setting lives in Stripe: turn on receipt emails under <em>Customer emails</em>. The customer
          then gets a payment receipt in the club&apos;s name. We send the ticket either way.
        </p>
      </CardContent>
    </Card>
  )
}
