import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import {
  expireStaleOffers,
  runAutomaticBookingForOpenShows,
  sendBookingReminders,
} from '@/lib/actions/booking'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Den daglige bookingjobben.
 *
 * Erstatter `publish-fullbooked`, som bare ryddet utløpte tilbud og
 * publiserte ferdige show. Nå er dette hjertet i automatikken: uten den
 * står bølgene stille, for ingenting annet enn et svar fra en komiker
 * fikk motoren til å kjøre.
 *
 * Tre ting, i denne rekkefølgen:
 *
 *  1. Merk tilbud som har gått ut. Må skje først — et utløpt tilbud som
 *     fortsatt står `sent` spiser en plass i bølgen, og da sendes det
 *     aldri et nytt.
 *  2. Minn komikerne på svarfrister som løper ut. Ligger dette sist, er det
 *     det første som ryker når kjøringen går over tiden — og en påminnelse
 *     som kommer dagen etter fristen er ingen påminnelse.
 *  3. Kjør motoren for alle show med ledige plasser. Den trapper opp bølgen
 *     med dagens kvote. Er siste plass fylt, får klubben «Line-up is booked –
 *     Publish?» — jobben publiserer ingenting selv, det gjør klubben.
 *
 * Kjøres kl. 06:00 UTC, så tilbudene lander til frokost og ikke midt på
 * natten. Se `.github/workflows/run-automation.yml`.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const expired = await expireStaleOffers()
  const reminded = await sendBookingReminders()
  const results = await runAutomaticBookingForOpenShows()

  const offersSent = results.reduce((sum, result) => sum + result.booking.offersCreated, 0)
  // `fullbooked` er sant for hvert show med full lineup, hver eneste dag.
  // `notifiedNow` er sant bare den ene gangen klubben faktisk fikk e-posten,
  // så tallet betyr det det står.
  const lineupsFull = results.filter((result) => result.fullbooked.notifiedNow).length

  console.log(
    `[cron/booking] ${results.length} shows · ${offersSent} offers sent · ${lineupsFull} lineup-full notices · ${expired} expired · ${reminded} reminders`,
  )

  return NextResponse.json({
    shows: results.length,
    offersSent,
    lineupsFull,
    expired,
    reminded,
  })
}
