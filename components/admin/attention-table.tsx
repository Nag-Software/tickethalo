import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { ATTENTION_LEVEL_LABELS, type AttentionAlert, type AttentionLevel } from '@/lib/booking-attention'

/**
 * «Trenger oppmerksomhet» — øverst på showoversikten.
 *
 * Systemet booker selv, og det gjør det stille. Når det ikke kommer videre,
 * er det ingen andre enn denne listen som sier det: bookeren har ingen grunn
 * til å åpne et show som ser ut som det går av seg selv.
 *
 * Skjules helt når den er tom. En tabell som står der og sier «ingenting å
 * gjøre» blir lest som pynt, og da blir den ikke lest når det står noe der.
 */

const LEVEL_STYLE: Record<AttentionLevel, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  followup: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short' }).format(new Date(value))
}

export function AttentionTable({ alerts }: { alerts: AttentionAlert[] }) {
  if (alerts.length === 0) return null

  const critical = alerts.filter((alert) => alert.level === 'critical').length

  return (
    <section className="mb-6 overflow-hidden rounded-xl border">
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-3">
        <AlertTriangle className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Trenger oppmerksomhet</h2>
        <span className="text-xs text-muted-foreground">
          {alerts.length} {alerts.length === 1 ? 'sak' : 'saker'}
          {critical > 0 && ` · ${critical} kritisk`}
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">Nivå</th>
              <th className="px-4 py-2 text-left font-medium">Show</th>
              <th className="px-4 py-2 text-left font-medium">Plass</th>
              <th className="px-4 py-2 text-left font-medium">Hva som er galt</th>
              <th className="px-4 py-2 text-right font-medium">Handling</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <tr key={alert.id} className="border-b last:border-0 align-top">
                <td className="whitespace-nowrap px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${LEVEL_STYLE[alert.level]}`}>
                    {ATTENTION_LEVEL_LABELS[alert.level]}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <Link href={alert.href} className="font-medium hover:underline">
                    {alert.showTitle}
                  </Link>
                  <span className="ml-2 whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(alert.showDate)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{alert.spot ?? '—'}</td>
                <td className="px-4 py-2.5">{alert.message}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <Link href={alert.href} className="text-xs font-semibold text-primary hover:underline">
                    {alert.action} →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
