import { NextResponse } from 'next/server'
import { repairMissingChargeFacts } from '@/lib/checkout/finalize'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { releaseDuePayouts, syncOpenPayouts } from '@/lib/payouts'
import { processRefundQueue } from '@/lib/refunds'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Tidsbudsjettet. Vercel dreper funksjonen ved `maxDuration`, og da kommer
 * verken logglinjene eller svaret — ingen ser hvilke klubber som ikke ble
 * utbetalt. Hvert steg får derfor en frist for når det slutter å starte nytt
 * arbeid, og jobben som helhet slutter ti sekunder før grensen, så det som er
 * i gang rekker å bli ferdig. Alle stegene tåler å stoppe midt i: reservasjoner
 * gjenopptas, og refusjoner, reparasjoner og synk er idempotente.
 */
const RUN_BUDGET_MS = 50_000

/**
 * Stegene før frigjøringen har egne, mindre budsjetter. En lang refusjonskø
 * eller mange utbetalinger å synke skal ikke spise tiden klubbene trenger for
 * å få pengene sine — det som ikke rekkes, tas neste kjøring.
 */
const REFUND_QUEUE_BUDGET_MS = 15_000
const CHARGE_REPAIR_BUDGET_MS = 10_000
const PAYOUT_SYNC_BUDGET_MS = 10_000

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
 *     En kø som bare ikke ble tømt innen budsjettet stopper ikke frigjøringen:
 *     hovedboken frigjør ikke ordrer som venter på refusjon, og en vedvarende
 *     kø ville ellers stengt utbetalingene for alle klubber.
 *  2. Betalingsdetaljer som mangler. Ordrer der Stripe ikke svarte ved kjøpet
 *     mangler provisjonen, og uten den regner hovedboken hele bruttobeløpet som
 *     klubbens. De må fylles inn før pengene frigjøres. Feiler steget helt,
 *     hoppes frigjøringen over.
 *  3. Status på utbetalinger som ikke er avgjort, i tilfelle en webhook ikke
 *     kom fram. En feilet utbetaling må være registrert før frigjøringen
 *     vurderer klubben.
 *  4. Frigjøringen, med resten av tiden.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const runDeadline = startedAt + RUN_BUDGET_MS
  // Budsjettet regnes fra når steget starter, men aldri forbi jobbens frist.
  const stepDeadline = (budgetMs: number) => Math.min(Date.now() + budgetMs, runDeadline)

  const refunds = await runStep('refund queue', () =>
    processRefundQueue({ deadline: stepDeadline(REFUND_QUEUE_BUDGET_MS) }),
  )
  const repair = await runStep('charge repair', () =>
    repairMissingChargeFacts({ deadline: stepDeadline(CHARGE_REPAIR_BUDGET_MS) }),
  )
  const sync = await runStep('payout sync', () => syncOpenPayouts({ deadline: stepDeadline(PAYOUT_SYNC_BUDGET_MS) }))

  const releaseBlocker = !refunds.ok
    ? 'skipped: the refund queue could not be processed'
    : !repair.ok
      ? 'skipped: orders missing Stripe charge details could not be repaired'
      : null
  const release: StepResult<Awaited<ReturnType<typeof releaseDuePayouts>>> = releaseBlocker
    ? { ok: false, error: releaseBlocker }
    : await runStep('payout release', () => releaseDuePayouts({ deadline: runDeadline }))

  if (refunds.ok) {
    const { processed, refunded, failed, deferred } = refunds.result
    console.log(
      `[cron/release-payouts] Refund queue: ${processed} processed, ${refunded} refunded, ${failed} failed, ${deferred} deferred`,
    )
  }
  if (repair.ok) {
    const { checked, repaired, failed } = repair.result
    console.log(`[cron/release-payouts] Charge repair: ${checked} checked, ${repaired} repaired, ${failed} failed`)
  }
  if (sync.ok) {
    const { checked, updated, deferred } = sync.result
    console.log(`[cron/release-payouts] Synced ${checked} payouts, ${updated} changed status, ${deferred} deferred`)
  }
  if (release.ok) {
    const { clubs, released, deferred } = release.result
    console.log(`[cron/release-payouts] ${clubs} clubs, released ${released}, ${deferred} clubs deferred`)
  }
  console.log(`[cron/release-payouts] Finished in ${Date.now() - startedAt} ms`)

  const ok = refunds.ok && repair.ok && sync.ok && release.ok

  // 500 når noe feilet, så det synes i cron-oversikten — med hele
  // oppsummeringen, så man ser hvilke steg som gikk. Utsatt arbeid er ikke en
  // feil: det står i oppsummeringen og tas neste kjøring.
  return NextResponse.json({ ok, refunds, repair, sync, release }, { status: ok ? 200 : 500 })
}
