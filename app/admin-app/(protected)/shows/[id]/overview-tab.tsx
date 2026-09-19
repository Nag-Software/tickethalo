import Link from 'next/link'
import { InteractiveBookingCard } from '@/components/admin/interactive-booking-card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { PublishShowDialog } from '@/components/admin/publish-show-dialog'
import { ShowDetailsForm } from './show-details-form'
import { publishReadiness } from '@/lib/publish-readiness'
import { appPath } from '@/lib/app-url'
import type { LineupArtist } from '@/components/admin/interactive-lineup'
import type { BookingSpot } from '@/lib/booking-spots'
import type { VenueLocation } from '@/lib/show-venue'
import { ticketSalesNote, toTicketSalesStateDto } from '@/lib/show-sales-shared'
import { ticketSalesState } from '@/lib/ticket-sales'
import type { ShowStatus } from '@/types/database'

type OverviewShow = {
  id: string
  title: string
  slug: string
  date: string
  start_time: string | null
  end_time: string | null
  venue_name: string | null
  venue_address: string | null
  club_location_id: string | null
  description: string | null
  capacity: number | null
  ticket_price: number | null
  currency: string
  status: ShowStatus
  poster_url: string | null
  ticket_sales_closed_at: string | null
  deleted_at: string | null
}

/**
 * The show's overview: the same booking card the shows list draws, next to one
 * plain section that both shows and edits every detail the show is built from.
 */
export function OverviewTab({
  show,
  spots,
  bookingCandidates,
  ticketsSold,
  hasRequirements,
  allSlotsFilled,
  locations,
  updateShowDetailsAction,
}: {
  show: OverviewShow
  /** Klubbens lagrede lokasjoner, til Venue-feltet. */
  locations: VenueLocation[]
  spots: BookingSpot[]
  /** Artists the booking card can offer or add to an open spot. */
  bookingCandidates: LineupArtist[]
  ticketsSold: number
  hasRequirements: boolean
  allSlotsFilled: boolean
  updateShowDetailsAction: React.ComponentProps<typeof ShowDetailsForm>['action']
}) {
  // Solgt-tallet alene sier ikke om salget står stille fordi det ikke har
  // åpnet ennå, eller fordi bookeren har stengt det.
  const salesNote = ticketSalesNote(toTicketSalesStateDto(ticketSalesState(show)))

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <InteractiveBookingCard
        currency={show.currency}
        artists={bookingCandidates}
        show={{
          id: show.id,
          title: show.title,
          date: show.date,
          status: show.status,
          posterUrl: show.poster_url,
          capacity: show.capacity,
          soldTickets: ticketsSold,
          ticketSalesNote: salesNote,
          spots,
        }}
      />

      <section className="space-y-6">
        <ShowDetailsForm
          showId={show.id}
          currency={show.currency}
          // Domenet leses på serveren (`APP_URL`), så lenken i feltet er den
          // samme som i e-postene — og lik i server- og klientrenderingen.
          eventsBaseUrl={appPath('/events/')}
          action={updateShowDetailsAction}
          locations={locations}
          initialValues={{
            title: show.title,
            slug: show.slug,
            date: show.date,
            start_time: (show.start_time ?? '').slice(0, 5),
            end_time: (show.end_time ?? '').slice(0, 5),
            venue_name: show.venue_name ?? '',
            venue_address: show.venue_address ?? '',
            club_location_id: show.club_location_id ?? '',
            save_location: '',
            capacity: show.capacity == null ? '' : String(show.capacity),
            ticket_price: show.ticket_price == null ? '' : String(show.ticket_price / 100),
            description: show.description ?? '',
          }}
        />

        <Separator />

        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Automation</h2>
          {show.status === 'draft' && !hasRequirements && (
            <Button variant="outline" size="sm" asChild className="w-full border-dashed">
              <Link href={`/admin-app/shows/${show.id}?tab=lineup`}>+ Add requirements first</Link>
            </Button>
          )}
          {['draft', 'booking', 'fullbooked'].includes(show.status) && hasRequirements && !allSlotsFilled && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              Offers are sent automatically when requirements are saved and when new artists are approved.
              Spots are only filled once artists accept the offer. When the lineup is full you get an email,
              and publish the show yourself. To run a shorter lineup,{' '}
              <Link href={`/admin-app/shows/${show.id}?tab=lineup`} className="font-medium underline underline-offset-2">
                delete a spot
              </Link>
              {' '}— then the lineup is full.
            </p>
          )}
          {allSlotsFilled && ['draft', 'booking', 'fullbooked'].includes(show.status) && (
            <div className="space-y-2 rounded-lg border border-purple-300/50 bg-purple-50 px-3 py-3 dark:bg-purple-950/20">
              <p className="text-xs leading-relaxed text-purple-700 dark:text-purple-400">
                The lineup is full. The show is not published yet — nothing goes live and no tickets are sold
                until you publish it.
              </p>
              <PublishShowDialog
                showId={show.id}
                showTitle={show.title}
                readiness={publishReadiness(show)}
                className="w-full"
              />
            </div>
          )}
          {show.status === 'published' && (
            <Button variant="outline" size="sm" asChild className="w-full">
              <Link href={`/events/${show.slug}`} target="_blank">🔗 View event page</Link>
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}
