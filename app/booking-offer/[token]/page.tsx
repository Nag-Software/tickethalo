import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { publicAcceptOfferAction, publicDeclineOfferAction } from './actions'
import { PublicHeader } from '@/components/public/public-header'

export default async function PublicBookingOfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ result?: string }>
}) {
  const { token } = await params
  const { result } = await searchParams

  const db = createAdminClient()
  const { data: offer } = await db
    .from('booking_offers')
    .select('id, status, fee_amount, currency, expires_at, show_id, show_requirement_id')
    .eq('token', token)
    .single()

  if (!offer) notFound()

  const [{ data: show }, { data: req }] = await Promise.all([
    db.from('shows').select('title, date, start_time, venue_name, venue_address').eq('id', offer.show_id).single(),
    db.from('show_requirements').select('role_name, compensation_type, compensation_amount, compensation_percent').eq('id', offer.show_requirement_id).single(),
  ])

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(
      new Date(`${value}T12:00:00`),
    )

  const formatMoney = (amount: number | null, currency: string) => {
    if (amount == null) return null
    return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: currency || 'NOK', maximumFractionDigits: 0 }).format(amount / 100)
  }

  const honorarLabel = (() => {
    if (offer.fee_amount != null) return formatMoney(offer.fee_amount, offer.currency)
    if (req?.compensation_type === 'percent' && req.compensation_percent != null) return `${req.compensation_percent}% av billettinntekter`
    if (req?.compensation_type === 'fixed' && req.compensation_amount != null) {
      return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: offer.currency || 'NOK', maximumFractionDigits: 0 }).format(Number(req.compensation_amount))
    }
    return 'Ikke satt'
  })()

  if (result === 'accepted') {
    return (
      <ResultPage
        icon="✓"
        title="Du er bekreftet!"
        message="Du er booket på showet. Du vil motta en bekreftelse på e-post med mer informasjon."
        variant="success"
      />
    )
  }
  if (result === 'filled_by_other') {
    return (
      <ResultPage
        icon="!"
        title="Spotten ble fylt av en annen"
        message="Takk for rask respons. Denne spotten ble dessverre akkurat fylt av en annen artist. Du vil fortsatt få nye tilbud i fremtiden."
        variant="neutral"
      />
    )
  }
  if (result === 'declined') {
    return (
      <ResultPage
        icon="✓"
        title="Takk for svaret"
        message="Du vil fortsatt få tilbud i fremtiden selv om denne datoen ikke passet."
        variant="neutral"
      />
    )
  }
  if (result === 'expired') {
    return (
      <ResultPage
        icon="!"
        title="Tilbudet er utløpt"
        message="Dette bookingtilbudet er ikke lenger aktivt."
        variant="neutral"
      />
    )
  }
  if (result === 'error') {
    return (
      <ResultPage
        icon="✗"
        title="Noe gikk galt"
        message="Tilbudet kan allerede ha blitt besvart eller er utløpt. Kontakt oss hvis du trenger hjelp."
        variant="error"
      />
    )
  }

  const isExpired = offer.expires_at ? new Date(offer.expires_at) < new Date() : false
  const canRespond = offer.status === 'sent' && !isExpired

  return (
    <main className="min-h-screen w-full bg-[#f3ead9] text-zinc-950">
      <PublicHeader transparent tone="light" />
      <section className="mx-auto mt-15 sm:mt-5 w-full grid max-w-xl gap-8 px-4 py-12 md:px-6 lg:px-8">
        <div className="md:pt-8 mx-auto">
          <h1 className="text-4xl sm:text-center font-black uppercase leading-[0.82] tracking-[-0.04em]">Bookingtilbud</h1>
          <p className="mt-5 max-w-md text-base font-medium text-zinc-700">Du har mottatt et tilbud om å opptre. Svar på tilbudet under.</p>
        </div>

        <div className="w-full mx-auto space-y-5">
        <div className="border-2 border-zinc-950 bg-[#fbf7ec] shadow-[8px_8px_0_rgba(24,24,27,0.14)]">
          <div className="border-b-2 border-zinc-950 px-6 py-4">
            <h2 className="text-2xl font-black tracking-tight">{show?.title ?? 'Show'}</h2>
            {show?.date && (
              <p className="text-sm font-medium capitalize text-zinc-600">{formatDate(show.date)}</p>
            )}
          </div>
          <div className="p-6 grid grid-cols-2 gap-4">
            <InfoCell label="Rolle" value={req?.role_name ?? 'Ikke satt'} />
            <InfoCell label="Honorar" value={honorarLabel ?? 'Ikke satt'} />
            <InfoCell label="Tidspunkt" value={show?.start_time?.slice(0, 5) ?? 'Kommer'} />
            <InfoCell label="Sted" value={show?.venue_name ?? show?.venue_address ?? 'Ikke satt'} />
          </div>
        </div>

        {canRespond && (
          <div className="space-y-3">
            <form action={publicAcceptOfferAction}>
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="w-full border-2 border-zinc-950 bg-[#b83224] px-4 py-3 font-bold text-white shadow-[4px_4px_0_#18181b] transition hover:bg-[#9f2d21]"
              >
                Ja, jeg tar spotten
              </button>
            </form>
            <form action={publicDeclineOfferAction}>
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="w-full border-2 border-zinc-950 bg-transparent px-4 py-3 text-sm font-bold transition hover:bg-zinc-950 hover:text-white"
              >
                Nei, det passer ikke
              </button>
            </form>
          </div>
        )}

        {!canRespond && !result && (
          <div className="border-2 border-zinc-950 bg-[#fbf7ec] p-4 text-center text-sm font-medium text-zinc-600">
            {isExpired ? 'Dette tilbudet er utløpt.' : `Status: ${offer.status.replaceAll('_', ' ')}`}
          </div>
        )}

        <p className="text-center text-xs font-medium text-zinc-600">
          Spørsmål? Kontakt oss på{' '}
          <a href="mailto:hei@humor.events" className="underline underline-offset-2">
            hei@humor.events
          </a>
        </p>
      </div>
      </section>
    </main>
  )
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  )
}

function ResultPage({
  icon,
  title,
  message,
  variant,
}: {
  icon: string
  title: string
  message: string
  variant: 'success' | 'neutral' | 'error'
}) {
  const colors = {
    success: 'text-[#1f6f43]',
    neutral: 'text-zinc-950',
    error: 'text-[#b83224]',
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3ead9] p-4 text-zinc-950">
      <div className="w-full max-w-sm border-2 border-zinc-950 bg-[#fbf7ec] p-8 text-center shadow-[8px_8px_0_rgba(24,24,27,0.14)]">
        <div className={`text-5xl font-black ${colors[variant]}`}>{icon}</div>
        <h1 className="mt-3 text-2xl font-black uppercase tracking-tight">{title}</h1>
        <p className="mt-2 text-sm font-medium text-zinc-700">{message}</p>
      </div>
    </main>
  )
}
