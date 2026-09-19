import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createClubAction } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AdminHeader } from '@/components/admin/admin-header'
import { ToastActionForm } from '@/components/toast-action-form'

export const metadata = { title: 'Ny klubb — Superadmin' }

export default async function NewClubPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string }>
}) {
  // Fylles ut når du kommer hit fra en betasøknad i /superadmin/beta-requests.
  const { name } = await searchParams

  return (
    <div>
      <AdminHeader title="Ny klubb" description="Klubben får admins og Stripe-oppsett etterpå" />

      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <Button variant="ghost" size="sm" asChild className="-mb-2 -ml-2 w-fit text-muted-foreground">
          <Link href="/superadmin/clubs">
            <ChevronLeft className="size-4" />
            Klubber
          </Link>
        </Button>

        <ToastActionForm action={createClubAction} className="max-w-lg space-y-5 rounded-xl border bg-card p-6">
          <div className="space-y-1.5">
            <Label htmlFor="name">Klubbnavn *</Label>
            <Input id="name" name="name" placeholder="Oslo Comedy Club" defaultValue={name ?? ''} required />
            <p className="text-xs text-muted-foreground">Adressen til klubbsiden lages av navnet.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">By</Label>
            <Input id="city" name="city" placeholder="Oslo" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Beskrivelse</Label>
            <Textarea id="description" name="description" rows={3} placeholder="Kort beskrivelse av klubben..." className="resize-none" />
          </div>
          <Button type="submit" className="w-full">Opprett klubb</Button>
        </ToastActionForm>
      </div>
    </div>
  )
}
