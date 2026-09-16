import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Vercel Cron sender `Authorization: Bearer <CRON_SECRET>`.
 *
 * Mangler hemmeligheten, avvises alt. Den gamle sjekken sammenlignet mot
 * `Bearer ${process.env.CRON_SECRET}`, og da slapp `Bearer undefined` inn —
 * hvem som helst kunne trigge utbetalinger og gebyrkjøringer.
 *
 * Begge sider hashes før sammenligningen: `timingSafeEqual` krever like lange
 * buffere, og med hash lekker verken innholdet eller lengden via svartiden.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.trim() === '') return false

  const header = request.headers.get('authorization')
  if (!header) return false

  const expected = createHash('sha256').update(`Bearer ${secret}`).digest()
  const actual = createHash('sha256').update(header).digest()

  return timingSafeEqual(actual, expected)
}
