import Image from 'next/image'
import { AdminHeader } from '@/components/admin/admin-header'
import { ToastActionForm } from '@/components/toast-action-form'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { cloneShowAction, createShowAction } from '../actions'
import { getClubAccess } from '@/lib/club-auth'
import { CURRENCIES, normalizeCurrency } from '@/lib/currencies'


/** The currency the club sells in — the default for a new show. */
async function getClubCurrency(clubId: string | null) {
  if (!clubId) return normalizeCurrency(null)

  const db = createAdminClient()
  const { data: club } = await db.from('clubs').select('currency').eq('id', clubId).maybeSingle()
  return normalizeCurrency(club?.currency)
}

function CurrencyOptions() {
  return (
    <>
      {CURRENCIES.map((currency) => (
        <option key={currency.code} value={currency.code}>
          {currency.code} — {currency.name}
        </option>
      ))}
    </>
  )
}

export default async function NewShowPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  const { from } = await searchParams
  const clubAccess = await getClubAccess()
  const clubCurrency = await getClubCurrency(clubAccess.selectedClubId)

  if (from) {
    const db = createAdminClient()
    let templateQuery = db.from('shows').select('*').eq('id', from)

    if (clubAccess.clubIds.length === 0) {
      templateQuery = templateQuery.eq('id', '00000000-0000-0000-0000-000000000000')
    } else {
      templateQuery = templateQuery.in('club_id', clubAccess.clubIds)
    }

    const { data: template } = await templateQuery.single()

    if (template) {
      return (
        <div>
          <AdminHeader
            title="New event from template"
            description={`Cloning: ${template.title}`}
            actions={
              <Link href="/admin-app/shows/new" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                ← Pick another template
              </Link>
            }
          />
          <div className="mx-auto max-w-4xl px-6 py-6 md:px-8 md:py-8">
            <ToastActionForm action={cloneShowAction} className="space-y-6">
              <input type="hidden" name="template_id" value={template.id} />

              {/* Show details */}
              <div className="rounded-2xl border bg-card p-5 shadow-sm md:p-6">
                <div className="mb-5 space-y-1">
                  <h2 className="font-semibold text-sm">Event details</h2>
                  <p className="text-sm text-muted-foreground">Adjust the name, date and practical details before the event is created.</p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field name="title" label="Title *" required defaultValue={template.title} />
                  <Field name="slug" label="Slug *" required placeholder={`${template.slug}-2`} />
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Field name="date" label="Date *" type="date" required />
                  <Field name="start_time" label="Start" type="time" defaultValue={(template.start_time ?? '').slice(0, 5)} />
                  <Field name="end_time" label="End" type="time" defaultValue={(template.end_time ?? '').slice(0, 5)} />
                </div>
                <div className="mt-4">
                  <Field name="venue_address" label="Venue / address" defaultValue={template.venue_address ?? ''} />
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Field name="capacity" label="Capacity" type="number" min={1} defaultValue={template.capacity?.toString() ?? ''} />
                  <Field name="ticket_price" label="Ticket price" type="number" min={0} step={0.01}
                    defaultValue={template.ticket_price ? String(template.ticket_price / 100) : ''} />
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Currency</label>
                    <select name="currency" defaultValue={normalizeCurrency(template.currency)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                      <CurrencyOptions />
                    </select>
                  </div>
                </div>
              </div>

              <button type="submit"
                className="w-full rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
                Book event →
              </button>
            </ToastActionForm>
          </div>
        </div>
      )
    }
  }

  // Template picker + blank option
  const db = createAdminClient()
  let showsQuery = db
    .from('shows')
    .select('id, title, date, start_time, venue_address, venue_name, poster_url')
    .order('date', { ascending: false })
    .limit(5)

  if (clubAccess.clubIds.length === 0) {
    showsQuery = showsQuery.eq('id', '00000000-0000-0000-0000-000000000000')
  } else {
    showsQuery = showsQuery.in('club_id', clubAccess.clubIds)
  }

  const { data: shows } = await showsQuery

  return (
    <div>
      <AdminHeader
        title="New show"
        description="Pick a template or start blank"
        actions={
          <Link href="/admin-app/shows" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Back
          </Link>
        }
      />
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-6 md:px-8 md:py-8">
        {/* Blank show */}
        <div className="rounded-2xl border bg-card p-5 shadow-sm md:p-6">
          <div className="mb-5 space-y-1">
            <h2 className="font-semibold text-sm">Blank show</h2>
            <p className="text-sm text-muted-foreground">Start from scratch with the essentials first.</p>
          </div>
          <ToastActionForm action={createShowAction} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field name="title" label="Title *" required />
              <Field name="slug" label="Slug *" required placeholder="my-show-2026" />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field name="date" label="Date *" type="date" required />
              <Field name="start_time" label="Start" type="time" />
              <Field name="end_time" label="End" type="time" />
            </div>
            <Field name="venue_address" label="Venue / address" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field name="capacity" label="Capacity" type="number" min={1} />
              <Field name="ticket_price" label="Ticket price" type="number" min={0} step={0.01} placeholder="199" />
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Currency</label>
                <select name="currency" defaultValue={clubCurrency}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <CurrencyOptions />
                </select>
              </div>
            </div>
            <button type="submit"
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              Create show
            </button>
          </ToastActionForm>
        </div>

        {/* Template picker */}
        {(shows ?? []).length > 0 && (
          <div className="rounded-2xl border bg-card p-5 shadow-sm md:p-6">
            <div className="mb-5 space-y-1">
              <h2 className="font-semibold text-sm">Clone an existing show</h2>
              <p className="text-sm text-muted-foreground">Use one of the last 5 shows as a starting point to save time.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(shows ?? []).map(s => (
                <Link
                  key={s.id}
                  href={`/admin-app/shows/new?from=${s.id}`}
                  className="group overflow-hidden rounded-xl border bg-background/80 transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <div className="relative aspect-[3/4] border-b bg-muted/20">
                    {s.poster_url ? (
                      <Image
                        src={s.poster_url}
                        alt={s.title}
                        fill
                        sizes="(max-width: 768px) 100vw, 33vw"
                        className="object-contain transition duration-300 group-hover:scale-[1.01]"
                      />
                    ) : (
                      <div className="flex h-full items-end bg-black p-4 text-white">
                        <p className="text-lg font-semibold leading-tight">{s.title}</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1 p-4">
                    <p className="font-semibold text-sm transition-colors group-hover:text-primary">{s.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.start_time ? s.start_time.slice(0, 5) : 'Time TBA'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.venue_address ?? s.venue_name ?? 'Venue TBA'}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ name, label, required, type = 'text', placeholder, min, step, defaultValue }: {
  name: string; label: string; required?: boolean; type?: string
  placeholder?: string; min?: number; step?: number; defaultValue?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input name={name} type={type} required={required} placeholder={placeholder}
        min={min} step={step} defaultValue={defaultValue}
        className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
    </div>
  )
}
