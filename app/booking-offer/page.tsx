import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  AcceptedResultPage,
  BOOKING_OFFER_MOCK_SCENARIOS,
  BookingOfferMockScenario,
  BookingOfferPage,
  DevMockBanner,
  FilledResultPage,
  MOCK_BOOKING_OFFER,
  ResultPage,
} from './components'

export default async function BookingOfferMockPage({
  searchParams,
}: {
  searchParams: Promise<{ mock?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()

  const { mock } = await searchParams

  if (!mock) {
    return (
      <main className="min-h-screen bg-[#f3ead9] p-8 text-zinc-950">
        <div className="mx-auto max-w-lg border-2 border-zinc-950 bg-[#fbf7ec] p-8 shadow-[8px_8px_0_rgba(24,24,27,0.14)]">
          <h1 className="text-2xl font-black uppercase tracking-tight">Bookingtilbud mock</h1>
          <p className="mt-3 text-sm font-medium text-zinc-700">
            Velg en tilstand for å forhåndsvise responsen. Kun tilgjengelig i development.
          </p>
          <ul className="mt-6 space-y-2">
            {BOOKING_OFFER_MOCK_SCENARIOS.map(({ id, label }) => (
              <li key={id}>
                <Link
                  href={`/booking-offer?mock=${id}`}
                  className="text-sm font-bold underline underline-offset-4 hover:text-[#b83224]"
                >
                  {label}
                </Link>
                <span className="ml-2 text-xs text-zinc-500">/booking-offer?mock={id}</span>
              </li>
            ))}
          </ul>
        </div>
      </main>
    )
  }

  const scenario = mock as BookingOfferMockScenario
  if (!BOOKING_OFFER_MOCK_SCENARIOS.some((entry) => entry.id === scenario)) notFound()

  const banner = <DevMockBanner current={scenario} />
  const details = MOCK_BOOKING_OFFER

  switch (scenario) {
    case 'available':
      return (
        <BookingOfferPage
          details={details}
          token="mock"
          canRespond
          isMock
          devBanner={banner}
        />
      )
    case 'accepted':
      return <AcceptedResultPage details={details} devBanner={banner} />
    case 'filled':
      return <FilledResultPage details={details} devBanner={banner} />
    case 'declined':
      return (
        <ResultPage
          icon="✓"
          title="Takk for svaret"
          message="Du vil fortsatt få tilbud i fremtiden selv om denne datoen ikke passet."
          variant="neutral"
          devBanner={banner}
        />
      )
    case 'canceled':
      return (
        <BookingOfferPage
          details={details}
          token="mock"
          canRespond={false}
          statusMessage="Status: cancelled"
          isMock
          devBanner={banner}
        />
      )
    case 'expired':
      return (
        <ResultPage
          icon="!"
          title="Tilbudet er utløpt"
          message="Dette bookingtilbudet er ikke lenger aktivt."
          variant="neutral"
          devBanner={banner}
        />
      )
    case 'expired-offer':
      return (
        <BookingOfferPage
          details={details}
          token="mock"
          canRespond={false}
          statusMessage="Dette tilbudet er utløpt."
          isMock
          devBanner={banner}
        />
      )
    case 'error':
      return (
        <ResultPage
          icon="✗"
          title="Noe gikk galt"
          message="Tilbudet kan allerede ha blitt besvart eller er utløpt. Kontakt oss hvis du trenger hjelp."
          variant="error"
          devBanner={banner}
        />
      )
  }
}
