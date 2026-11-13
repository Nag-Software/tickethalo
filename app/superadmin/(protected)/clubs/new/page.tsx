import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClubAction } from '../actions'
import { PendingButton } from '@/components/pending-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AdminHeader } from '@/components/admin/admin-header'
import { ToastActionForm } from '@/components/toast-action-form'
import { CLUB_COUNTRIES, DEFAULT_CLUB_COUNTRY } from '@/lib/ticket-vat'

export const metadata = { title: 'New club — Superadmin' }

export default async function NewClubPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; email?: string; request?: string }>
}) {
  // Fylles ut når du kommer hit fra en betasøknad i /superadmin/beta-requests:
  // navnet og e-posten fra søknaden, og søknadens ID så den merkes godkjent.
  const { name, email, request } = await searchParams

  return (
    <div>
      <AdminHeader title="New club" description="The club gets an account and an admin right away. The club sets up Stripe itself afterwards." />

      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <Button variant="ghost" size="sm" asChild className="-mb-2 -ml-2 w-fit text-muted-foreground">
          <Link href="/superadmin/clubs">
            <ChevronLeft className="size-4" />
            Clubs
          </Link>
        </Button>

        <ToastActionForm action={createClubAction} className="max-w-lg space-y-5 rounded-xl border bg-card p-6">
          {request && <input type="hidden" name="beta_request_id" value={request} />}
          <div className="space-y-1.5">
            <Label htmlFor="name">Club name *</Label>
            <Input id="name" name="name" placeholder="Oslo Comedy Club" defaultValue={name ?? ''} required />
            <p className="text-xs text-muted-foreground">The club page address is made from the name.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">Club email</Label>
            <Input id="admin-email" name="admin_email" type="email" placeholder="hello@club.com" defaultValue={email ?? ''} />
            <p className="text-xs text-muted-foreground">
              Becomes the club’s admin right away and gets an email with a link to set a password. Empty = no admin yet.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">City</Label>
            <Input id="city" name="city" placeholder="Oslo" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="country">Country</Label>
            <select
              id="country"
              name="country"
              defaultValue={DEFAULT_CLUB_COUNTRY}
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {CLUB_COUNTRIES.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.label} · {country.currency}
                  {country.ticketVatBps > 0 ? ` · ${country.ticketVatBps / 100}% VAT on tickets` : ' · VAT-free tickets'}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Sets the Stripe account’s country, the currency and the VAT on tickets. Can’t be changed once Stripe is connected.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" rows={3} placeholder="Short description of the club..." className="resize-none" />
          </div>
          {/* Oppretter klubben, kontoen og sender e-posten: et par sekunder. */}
          <PendingButton type="submit" className="w-full" pendingLabel="Creating club and sending email…">
            Create club
          </PendingButton>
        </ToastActionForm>
      </div>
    </div>
  )
}
