import Link from 'next/link'
import { PublicHeader } from '@/components/public/public-header'
import { OfferResponseButtons } from './offer-response-buttons'
import { formatBookingDate } from '@/lib/booking-offer-format'

export type BookingOfferDetails = {
  clubName: string
  showTitle: string
  showDate: string | null
  startTime: string | null
  venueName: string | null
  venueAddress: string | null
  spotLabel: string
  honorarLabel: string
}

export const MOCK_BOOKING_OFFER: BookingOfferDetails = {
  clubName: 'Oslo Comedy Club',
  showTitle: 'Humor i Parken',
  showDate: '2026-07-15',
  startTime: '19:30:00',
  venueName: 'Parkteatret',
  venueAddress: 'Olaf Ryes plass 11, Oslo',
  spotLabel: 'Klubbkveld',
  honorarLabel: '1 500 kr',
}

export function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-bold uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  )
}

export function ResultPage({
  icon,
  title,
  message,
  variant,
  details,
  devBanner,
}: {
  icon: string
  title: string
  message: string
  variant: 'success' | 'neutral' | 'error'
  details?: Array<{ label: string; value: string }>
  devBanner?: React.ReactNode
}) {
  const colors = {
    success: 'text-[#1f6f43]',
    neutral: 'text-zinc-950',
    error: 'text-[#b83224]',
  }
  return (
    <>
      {devBanner}
      <main className="public-shell flex min-h-screen items-center justify-center bg-[#f3ead9] p-4 text-zinc-950">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-[#fbf7ec] p-8 text-center shadow-lg">
          <div className={`text-5xl font-semibold ${colors[variant]}`}>{icon}</div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
          {details && details.length > 0 && (
            <dl className="mt-5 space-y-3 border-t border-border pt-5 text-left">
              {details.map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-xs font-bold uppercase tracking-widest text-zinc-500">{label}</dt>
                  <dd className="mt-0.5 text-sm font-bold capitalize">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-5 text-sm font-medium text-zinc-700">{message}</p>
        </div>
      </main>
    </>
  )
}

export function AcceptedResultPage({
  details,
  devBanner,
}: {
  details: BookingOfferDetails
  devBanner?: React.ReactNode
}) {
  const formatDate = formatBookingDate
  return (
    <ResultPage
      icon="✓"
      title={`Du er nå booket hos ${details.clubName}`}
      details={[
        { label: 'Scene', value: details.venueName ?? 'Ikke oppgitt' },
        { label: 'Adresse', value: details.venueAddress ?? 'Ikke oppgitt' },
        { label: 'Dato', value: details.showDate ? formatDate(details.showDate) : 'Ikke oppgitt' },
        { label: 'Type spot', value: details.spotLabel },
        { label: 'Honorar', value: details.honorarLabel },
      ]}
      message="Vi gleder oss til å se deg på scenen! Møt opp 30 minutter før showstart."
      variant="success"
      devBanner={devBanner}
    />
  )
}

export function FilledResultPage({
  details,
  devBanner,
}: {
  details: BookingOfferDetails
  devBanner?: React.ReactNode
}) {
  const formatDate = formatBookingDate
  const dateLabel = details.showDate ? formatDate(details.showDate) : 'den datoen'
  return (
    <ResultPage
      icon="!"
      title="Spotten er fylt"
      message={`Beklager, en annen komiker har akseptert spotten hos ${details.clubName} den ${dateLabel}. Spotten er fylt, men det vil forhåpentligvis være en ny mulighet om ikke så lenge.`}
      variant="neutral"
      devBanner={devBanner}
    />
  )
}

export function BookingOfferPage({
  details,
  token,
  canRespond,
  statusMessage,
  isMock = false,
  devBanner,
}: {
  details: BookingOfferDetails
  token: string
  canRespond: boolean
  statusMessage?: string
  isMock?: boolean
  devBanner?: React.ReactNode
}) {
  const formatDate = formatBookingDate

  return (
    <>
      {devBanner}
      <main className="public-shell min-h-screen w-full bg-[#f3ead9] text-zinc-950">
        <PublicHeader transparent tone="light" />
        <section className="mx-auto mt-15 sm:mt-5 w-full grid max-w-xl gap-8 px-4 py-12 md:px-6 lg:px-8">
          <div className="md:pt-8 mx-auto">
            <h1 className="text-4xl sm:text-center font-semibold leading-[0.82] tracking-[-0.04em]">Bookingtilbud</h1>
            <p className="mt-5 max-w-md text-base font-medium text-zinc-700">Du har mottatt et tilbud om å opptre. Svar på tilbudet under.</p>
          </div>

          <div className="w-full mx-auto space-y-5">
            <div className="rounded-2xl border border-border bg-[#fbf7ec] shadow-lg">
              <div className="border-b border-border px-6 py-4">
                <h2 className="text-2xl font-semibold tracking-tight">{details.showTitle}</h2>
                {details.showDate && (
                  <p className="text-sm font-medium capitalize text-zinc-600">{formatDate(details.showDate)}</p>
                )}
              </div>
              <div className="p-6 grid grid-cols-2 gap-4">
                <InfoCell label="Type spot" value={details.spotLabel} />
                <InfoCell label="Honorar" value={details.honorarLabel} />
                <InfoCell label="Tidspunkt" value={details.startTime?.slice(0, 5) ?? 'Kommer'} />
                <InfoCell label="Scene" value={details.venueName ?? 'Ikke oppgitt'} />
              </div>
            </div>

            {canRespond &&
              (isMock ? (
                <div className="space-y-3">
                  <button
                    type="button"
                    disabled
                    className="w-full rounded-full bg-[#b83224] px-4 py-3 font-semibold text-white opacity-90"
                  >
                    Ja, jeg tar spotten
                  </button>
                  <button
                    type="button"
                    disabled
                    className="w-full rounded-full border border-border bg-transparent px-4 py-3 text-sm font-semibold opacity-90"
                  >
                    Nei, det passer ikke
                  </button>
                </div>
              ) : (
                <OfferResponseButtons token={token} />
              ))}

            {!canRespond && statusMessage && (
              <div className="rounded-xl border border-border bg-[#fbf7ec] p-4 text-center text-sm font-medium text-zinc-600">
                {statusMessage}
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
    </>
  )
}

export const BOOKING_OFFER_MOCK_SCENARIOS = [
  { id: 'available', label: 'Tilgjengelig' },
  { id: 'accepted', label: 'Akseptert' },
  { id: 'filled', label: 'Spot fylt' },
  { id: 'declined', label: 'Avslått' },
  { id: 'canceled', label: 'Kansellert' },
  { id: 'expired', label: 'Utløpt (resultat)' },
  { id: 'expired-offer', label: 'Utløpt (tilbud)' },
  { id: 'error', label: 'Feil' },
] as const

export type BookingOfferMockScenario = (typeof BOOKING_OFFER_MOCK_SCENARIOS)[number]['id']

export function DevMockBanner({ current }: { current?: BookingOfferMockScenario }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-[#fff3bf] px-3 py-2 text-xs font-medium text-zinc-950">
      <span className="font-black uppercase tracking-wide">Dev mock</span>
      <span className="mx-2 text-zinc-500">·</span>
      {BOOKING_OFFER_MOCK_SCENARIOS.map(({ id, label }) => (
        <Link
          key={id}
          href={`/booking-offer?mock=${id}`}
          className={`mr-3 underline underline-offset-2 ${current === id ? 'font-black text-[#b83224]' : 'hover:text-[#b83224]'}`}
        >
          {label}
        </Link>
      ))}
    </div>
  )
}
