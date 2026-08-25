import Link from 'next/link'
import { ArrowLeft, Building2, Inbox, Mail } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { Button } from '@/components/ui/button'
import { DeleteButton } from '@/components/admin/delete-button'
import { setBetaRequestStatusAction, deleteBetaRequestAction } from './actions'
import type { ClubBetaRequest, ClubBetaRequestStatus } from '@/types/database'

export const metadata = { title: 'Betasøknader — Superadmin' }

/** Rekkefølgen knappene står i, og hvordan hver status ser ut i listen. */
const STATUS: Record<ClubBetaRequestStatus, { label: string; pill: string }> = {
  new:       { label: 'Ny',        pill: 'bg-amber-100 text-amber-700' },
  contacted: { label: 'Kontaktet', pill: 'bg-blue-100 text-blue-700' },
  approved:  { label: 'Godkjent',  pill: 'bg-emerald-100 text-emerald-700' },
  declined:  { label: 'Avslått',   pill: 'bg-muted text-muted-foreground' },
}

const SOURCE_LABEL: Record<string, string> = {
  'login-hero': 'Hero-lenken',
  'login-form': 'Under innloggingen',
  'login-booker': 'One-click Booker',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('nb-NO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default async function BetaRequestsPage() {
  const db = createAdminClient()

  const { data } = await db
    .from('club_beta_requests')
    .select('*')
    .order('created_at', { ascending: false })

  const requests = (data ?? []) as ClubBetaRequest[]
  const pending = requests.filter((r) => r.status === 'new')
  const handled = requests.filter((r) => r.status !== 'new')

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/superadmin/clubs">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <Inbox className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Betasøknader</h1>
          <span className="text-sm text-muted-foreground">
            {pending.length} ubehandlet av {requests.length}
          </span>
        </div>
      </header>

      <main className="p-6 space-y-8">
        {requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
            <Inbox className="size-10 opacity-30" />
            <p className="text-sm">Ingen har søkt om betatilgang ennå.</p>
          </div>
        ) : (
          <>
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                Nye søknader ({pending.length})
              </h2>
              {pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">Alt er behandlet.</p>
              ) : (
                pending.map((request) => <RequestCard key={request.id} request={request} />)
              )}
            </section>

            {handled.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Behandlet ({handled.length})
                </h2>
                {handled.map((request) => (
                  <RequestCard key={request.id} request={request} />
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function RequestCard({ request }: { request: ClubBetaRequest }) {
  const status = STATUS[request.status] ?? STATUS.new
  const source = request.source ? SOURCE_LABEL[request.source] ?? request.source : null

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{request.club_name}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.pill}`}>
              {status.label}
            </span>
          </div>
          <a
            href={`mailto:${request.email}?subject=Tickethalo beta`}
            className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Mail className="size-3.5" />
            {request.email}
          </a>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Søkte {formatDate(request.created_at)}</span>
            {source && <span>Fra: {source}</span>}
          </div>
        </div>

        {/* Snarveien fra en godkjent søknad til klubben den gjelder. */}
        <Button variant="outline" size="sm" asChild>
          <Link href={`/superadmin/clubs/new?name=${encodeURIComponent(request.club_name)}`}>
            <Building2 className="size-4" />
            Opprett klubb
          </Link>
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
        {(Object.keys(STATUS) as ClubBetaRequestStatus[])
          .filter((value) => value !== request.status)
          .map((value) => (
            <form key={value} action={setBetaRequestStatusAction}>
              <input type="hidden" name="id" value={request.id} />
              <input type="hidden" name="status" value={value} />
              <button
                type="submit"
                className="rounded border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {STATUS[value].label}
              </button>
            </form>
          ))}

        <div className="ml-auto">
          <DeleteButton
            action={deleteBetaRequestAction}
            id={request.id}
            idField="id"
            label="Slett"
            confirmMessage={`Slette søknaden fra ${request.club_name}?`}
          />
        </div>
      </div>
    </div>
  )
}
