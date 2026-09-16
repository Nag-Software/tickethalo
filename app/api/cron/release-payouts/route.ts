import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { releaseDuePayouts, syncOpenPayouts } from '@/lib/payouts'
import { processRefundQueue } from '@/lib/refunds'

export const runtime = 'nodejs'
export const maxDuration = 60

type StepResult<T> = { ok: true; result: T } | { ok: false; error: string }

/** Hvert steg for seg: en feil i ett skal ikke skjule hva de andre gjorde. */
async function runStep<T>(name: string, run: () => Promise<T>): Promise<StepResult<T>> {
  try {
    return { ok: true, result: await run() }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[cron/release-payouts] ${name} failed: ${message}`)
    return { ok: false, error: message }
  }
}

/**
 * Frigir billettinntekten til klubbens bankkonto etter at showet er avholdt.
 * Se `lib/payouts.ts` for hvorfor pengene holdes til da, og hvorfor en
 * utbetaling ikke kan gå ut to ganger.
 *
 * Rekkefølgen betyr noe:
 *  1. Refusjonskøen først. Betalinger som ikke ga billetter skal tilbake til
 *     kunden, og pengene står på klubbens saldo til de er refundert. Går
 *     utbetalingen først, kan den tømme saldoen refusjonen skulle tatt av.
 *     Feiler steget helt, hoppes frigjøringen over denne gangen av samme grunn.
 *  2. Status på utbetalinger som ikke er avgjort, i tilfelle en webhook ikke
 *     kom fram. En feilet utbetaling må være registrert før frigjøringen
 *     vurderer klubben.
 *  3. Frigjøringen.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const refunds = await runStep('refund queue', () => processRefundQueue())
  const sync = await runStep('payout sync', () => syncOpenPayouts())
  const release: StepResult<Awaited<ReturnType<typeof releaseDuePayouts>>> = refunds.ok
    ? await runStep('payout release', () => releaseDuePayouts())
    : { ok: false, error: 'skipped: the refund queue could not be processed' }

  if (refunds.ok) {
    const { processed, refunded, failed } = refunds.result
    console.log(`[cron/release-payouts] Refund queue: ${processed} processed, ${refunded} refunded, ${failed} failed`)
  }
  if (sync.ok) {
    console.log(`[cron/release-payouts] Synced ${sync.result.checked} payouts, ${sync.result.updated} changed status`)
  }
  if (release.ok) {
    console.log(`[cron/release-payouts] ${release.result.clubs} clubs, released ${release.result.released}`)
  }

  const ok = refunds.ok && sync.ok && release.ok

  // 500 når noe feilet, så det synes i cron-oversikten — med hele
  // oppsummeringen, så man ser hvilke steg som gikk.
  return NextResponse.json({ ok, refunds, sync, release }, { status: ok ? 200 : 500 })
}
