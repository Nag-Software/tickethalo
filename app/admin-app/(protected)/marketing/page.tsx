import Link from 'next/link'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { AdminHeader } from '@/components/admin/admin-header'
import type { ClubContactSource } from '@/types/database'
import { adsConsentState, type ContactStatusFilter } from '@/lib/marketing/contact-export'
import { CONTACT_FILTERS, applyContactFilter, contactSearchTerm, toContactFilter } from '@/lib/marketing/contact-filter'
import { ImportContactsButton } from './import-dialog'
import { ContactActions } from './contact-actions'
import { ExportButtons } from './export-buttons'

/**
 * Klubbens e-postliste.
 *
 * Alle som har sagt ja til e-post fra klubben: ved billettkjøp (avkrysningen
 * i checkout, via triggeren i migrasjon 077) eller fra en liste klubben har
 * importert. Avmeldte står også her, merket — klubben skal kunne se at noen
 * har meldt seg av, og raden er det som hindrer at de kommer inn igjen.
 *
 * Utsendingen skjer fra markedsføringsfanen på hvert show.
 *
 * Annonsesamtykket (migrasjon 090) er et eget ja, vist som egen kolonne og
 * filter. «Export CSV» gir det som vises; «Export for Meta» bare dem med
 * aktivt annonsesamtykke. Se export/route.ts.
 */

type StatusFilter = ContactStatusFilter
type PageParams = { q?: string; status?: string; page?: string }

const PAGE_SIZE = 50

const SOURCE_LABELS: Record<ClubContactSource, string> = {
  purchase: 'Purchase',
  import: 'Import',
  signup: 'Sign-up',
}

function buildHref({ q, status, page }: { q?: string; status?: StatusFilter; page?: number }) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (status && status !== 'all') params.set('status', status)
  if (page && page > 1) params.set('page', String(page))
  const query = params.toString()
  return `/admin-app/marketing${query ? `?${query}` : ''}`
}

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Oslo' }).format(new Date(value))
    : '—'

export default async function MarketingPage({ searchParams }: { searchParams: Promise<PageParams> }) {
  const params = await searchParams
  const searchQuery = params.q?.trim().slice(0, 100) ?? ''
  const filter = toContactFilter(params.status)
  const clubId = await getDefaultClubIdForAdmin()
  const db = createAdminClient()

  const total = (status: StatusFilter) =>
    applyContactFilter(db.from('club_contacts').select('id', { count: 'exact', head: true }).eq('club_id', clubId), status)

  const term = contactSearchTerm(searchQuery)
  const listQuery = applyContactFilter(
    db
      .from('club_contacts')
      .select(
        'id, email, name, phone, source, consent_at, last_show_id, last_purchase_at, unsubscribed_at, ads_consent_at, ads_withdrawn_at',
        { count: 'exact' },
      )
      .eq('club_id', clubId),
    filter,
    term,
  )

  const requestedPage = Math.max(1, Number(params.page ?? 1) || 1)
  const start = (requestedPage - 1) * PAGE_SIZE

  const [{ data: club }, all, subscribed, unsubscribed, ads, { data: contacts, count: matching, error }] = await Promise.all([
    db.from('clubs').select('name').eq('id', clubId).maybeSingle(),
    total('all'),
    total('subscribed'),
    total('unsubscribed'),
    total('ads'),
    listQuery.order('created_at', { ascending: false }).range(start, start + PAGE_SIZE - 1),
  ])

  // En tom liste ville sett ut som «ingen har meldt seg på». PGRST103 er en
  // side forbi slutten (en gammel lenke etter sletting) — den er bare tom.
  if (error && error.code !== 'PGRST103') throw new Error(`Could not load contacts: ${error.message}`)

  const counts: Record<StatusFilter, number> = {
    all: all.count ?? 0,
    subscribed: subscribed.count ?? 0,
    unsubscribed: unsubscribed.count ?? 0,
    ads: ads.count ?? 0,
  }

  const showIds = [...new Set((contacts ?? []).map((contact) => contact.last_show_id).filter((id): id is string => Boolean(id)))]
  const { data: shows } = showIds.length
    ? await db.from('shows').select('id, title, date').in('id', showIds)
    : { data: [] as Array<{ id: string; title: string; date: string }> }
  const showMap = new Map((shows ?? []).map((show) => [show.id, show]))

  const pageCount = Math.max(1, Math.ceil((matching ?? 0) / PAGE_SIZE))
  const page = Math.min(requestedPage, pageCount)
  const visible = contacts ?? []
  const clubName = club?.name ?? 'your club'

  return (
    <div>
      <AdminHeader
        title="Marketing"
        description={`${counts.all.toLocaleString('en-GB')} contacts · ${counts.subscribed.toLocaleString('en-GB')} subscribed`}
      />

      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Email list</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              People who said yes to emails from {clubName} when they bought a ticket, and people you have imported.
              Send them an email from the Marketing tab on a show.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ExportButtons
              exportHref={`/admin-app/marketing/export?${new URLSearchParams({
                kind: 'contacts',
                ...(filter !== 'all' ? { status: filter } : {}),
                ...(searchQuery ? { q: searchQuery } : {}),
              }).toString()}`}
              adsAudience={counts.ads}
              clubName={clubName}
            />
            <ImportContactsButton clubName={clubName} />
          </div>
        </div>

        <form action="/admin-app/marketing" className="relative">
          {filter !== 'all' && <input type="hidden" name="status" value={filter} />}
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            name="q"
            defaultValue={searchQuery}
            placeholder="Search by name, email or phone"
            aria-label="Search contacts"
            className="h-11 w-full rounded-full border bg-card pl-11 pr-11 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-[var(--ev-accent-fill)]"
          />
          {searchQuery && (
            <Link
              href={buildHref({ status: filter })}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </Link>
          )}
          <button type="submit" className="sr-only">
            Search
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {CONTACT_FILTERS.map((option) => {
            const active = filter === option.value
            return (
              <Link
                key={option.value}
                href={buildHref({ q: searchQuery, status: option.value })}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  active ? 'bg-[var(--ev-accent-fill)] text-white' : 'border text-muted-foreground hover:text-foreground'
                }`}
              >
                {option.label}
                <span className={`text-xs tabular-nums ${active ? 'text-white/70' : 'text-muted-foreground/60'}`}>
                  {counts[option.value].toLocaleString('en-GB')}
                </span>
              </Link>
            )
          })}
        </div>

        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-5 py-3 text-left font-medium">Contact</th>
                  <th className="px-5 py-3 text-left font-medium">Phone</th>
                  <th className="px-5 py-3 text-left font-medium">Source</th>
                  <th className="px-5 py-3 text-left font-medium">Consent</th>
                  <th className="px-5 py-3 text-left font-medium">Last show bought</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-left font-medium">Ads</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map((contact) => {
                  const show = contact.last_show_id ? showMap.get(contact.last_show_id) : null
                  const adsState = adsConsentState(contact)
                  return (
                    <tr key={contact.id} className="border-b transition-colors last:border-0 hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <div className="font-medium">{contact.name ?? '—'}</div>
                        <div className="text-xs text-muted-foreground">{contact.email}</div>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{contact.phone ?? '—'}</td>
                      <td className="px-5 py-3 text-muted-foreground">{SOURCE_LABELS[contact.source]}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{formatDate(contact.consent_at)}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {show ? (
                          <>
                            <div className="text-foreground">{show.title}</div>
                            <div className="text-xs">{formatDate(contact.last_purchase_at)}</div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3">
                        {contact.unsubscribed_at ? (
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            Unsubscribed {formatDate(contact.unsubscribed_at)}
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                            Subscribed
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                        {adsState === 'active' ? (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                            Yes · {formatDate(contact.ads_consent_at)}
                          </span>
                        ) : adsState === 'withdrawn' ? (
                          <span className="text-xs">Withdrawn</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <ContactActions
                          contactId={contact.id}
                          label={contact.name ?? contact.email}
                          subscribed={!contact.unsubscribed_at}
                          adsConsent={adsState === 'active'}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {visible.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-sm text-muted-foreground">
              {searchQuery || filter !== 'all' ? (
                <>
                  <p className="max-w-md">
                    {searchQuery
                      ? `No contacts match “${searchQuery}”.`
                      : filter === 'ads'
                        ? 'No one has said yes to ads yet. People who tick “Show me relevant ads” at checkout show up here.'
                        : 'No contacts here.'}
                  </p>
                  <Link href="/admin-app/marketing" className="font-medium text-foreground hover:underline">
                    Show all contacts
                  </Link>
                </>
              ) : (
                <p className="max-w-md">
                  No one on your list yet. People who tick “send me emails” when they buy a ticket show up here
                  automatically. Have a list from before? Import it as a CSV file.
                </p>
              )}
            </div>
          )}
        </div>

        {(matching ?? 0) > 0 && (
          <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
            <span>
              Showing {start + 1}–{start + visible.length} of {(matching ?? 0).toLocaleString('en-GB')}
            </span>
            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <PageStep href={buildHref({ q: searchQuery, status: filter, page: page - 1 })} disabled={page === 1} label="Previous page">
                  <ChevronLeft className="size-4" />
                </PageStep>
                <span className="px-2 tabular-nums">
                  {page} / {pageCount}
                </span>
                <PageStep href={buildHref({ q: searchQuery, status: filter, page: page + 1 })} disabled={page === pageCount} label="Next page">
                  <ChevronRight className="size-4" />
                </PageStep>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PageStep({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  if (disabled) {
    return (
      <span aria-hidden className="flex size-8 items-center justify-center rounded-full opacity-40">
        {children}
      </span>
    )
  }
  return (
    <Link href={href} aria-label={label} className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-muted hover:text-foreground">
      {children}
    </Link>
  )
}
