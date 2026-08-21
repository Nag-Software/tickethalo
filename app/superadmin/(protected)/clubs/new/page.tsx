import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClubAction } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const metadata = { title: 'Ny klubb — Superadmin' }

export default function NewClubPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/superadmin/clubs">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">Ny klubb</h1>
      </header>

      <main className="p-6 max-w-lg">
        <form action={createClubAction} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="name">Klubbnavn *</Label>
            <Input id="name" name="name" placeholder="Oslo Comedy Club" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">By</Label>
            <Input id="city" name="city" placeholder="Oslo" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Beskrivelse</Label>
            <textarea
              id="description"
              name="description"
              rows={3}
              placeholder="Kort beskrivelse av klubben..."
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
          </div>
          <Button type="submit" className="w-full">Opprett klubb</Button>
        </form>
      </main>
    </div>
  )
}
