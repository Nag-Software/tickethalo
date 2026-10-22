import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { sendDueLineupReminders } from '@/lib/lineup-messages'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Påminnelsen til lineupen, 5 dager før showet. Reglene står i
 * lib/lineup-reminders.ts: Oslo-dato, et vindu på fem dager og én gang per
 * plass.
 *
 * Egen rute, ikke en del av bookingjobben: feiler den ene, skal den andre
 * likevel gå. Kjøres 06:00 UTC fra .github/workflows/run-automation.yml.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Ti sekunder før Vercel dreper funksjonen slutter kjøringen å ta nye show.
  const result = await sendDueLineupReminders(new Date(), { deadline: Date.now() + 50_000 })
  console.log(
    `[cron/lineup-reminders] ${result.shows} shows · ${result.reminded} reminded · ${result.failed} failed · ${result.skipped} left for next run`,
  )

  return NextResponse.json(result, { status: result.failed > 0 && result.reminded === 0 ? 500 : 200 })
}
