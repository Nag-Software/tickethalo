import Link from 'next/link'
import { cn } from '@/lib/utils'

export const artistPageClass = 'mx-auto w-full max-w-6xl px-4 py-8 md:px-6 lg:px-8'
export const artistCardClass = 'border border-black/10 bg-white'
export const artistPrimaryButtonClass =
  'inline-flex h-10 items-center justify-center gap-2 border border-black bg-black px-4 text-sm font-medium text-white transition hover:border-[#ff6bff] hover:bg-[#ff6bff] hover:text-black'
export const artistSecondaryButtonClass =
  'inline-flex h-10 items-center justify-center gap-2 border border-black bg-transparent px-4 text-sm font-medium transition hover:bg-black hover:text-white'

export function ArtistPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(artistPageClass, className)}>{children}</div>
}

export function ArtistPageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-black/10 pb-4">
      <div>
        <h1 className="text-2xl font-medium tracking-tight md:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function ArtistTabs({
  items,
}: {
  items: Array<{ href: string; label: string; active: boolean; count?: number }>
}) {
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            'inline-flex h-9 items-center gap-2 border px-3 text-sm font-medium transition',
            item.active
              ? 'border-black bg-black text-white'
              : 'border-black/15 bg-white text-zinc-700 hover:border-black hover:text-black',
          )}
        >
          {item.label}
          {item.count != null && item.count > 0 && (
            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', item.active ? 'bg-white/20' : 'bg-zinc-100')}>
              {item.count}
            </span>
          )}
        </Link>
      ))}
    </div>
  )
}

export function ArtistList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-black/10 border-y border-black/10">{children}</ul>
}

export function ArtistListRow({
  title,
  meta,
  aside,
  href,
  actions,
}: {
  title: string
  meta?: string
  aside?: React.ReactNode
  href?: string
  actions?: React.ReactNode
}) {
  const content = (
    <div className="grid items-stretch gap-3 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate font-medium tracking-tight">{title}</p>
        {meta && <p className="mt-0.5 truncate text-sm text-zinc-500">{meta}</p>}
        {aside && <div className="mt-2 flex flex-wrap gap-2">{aside}</div>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
      )}
    </div>
  )

  if (!href) return <li>{content}</li>

  return (
    <li className="transition hover:bg-zinc-50/80">
      <Link href={href} className="block">
        {content}
      </Link>
    </li>
  )
}

export function ArtistEmpty({ text }: { text: string }) {
  return (
    <div className="grid min-h-32 place-items-center border border-dashed border-black/20 p-8 text-center text-sm text-zinc-500">
      {text}
    </div>
  )
}

export function ArtistNotice({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' }) {
  return (
    <div
      className={cn(
        'mb-6 border px-4 py-3 text-sm',
        tone === 'success' && 'border-black/10 bg-[#ff6bff]/15 text-zinc-800',
        tone === 'warning' && 'border-amber-300 bg-amber-50 text-amber-950',
        tone === 'neutral' && 'border-black/10 bg-zinc-50 text-zinc-700',
      )}
    >
      {children}
    </div>
  )
}

export function ArtistBadge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'accent' | 'muted' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        variant === 'accent' && 'bg-[#ff6bff]/25 text-black',
        variant === 'muted' && 'bg-zinc-100 text-zinc-600',
        variant === 'default' && 'border border-black/10 text-zinc-700',
      )}
    >
      {children}
    </span>
  )
}

export function formatArtistDate(value: string, style: 'short' | 'long' | 'weekday' = 'short') {
  if (style === 'weekday') {
    return new Intl.DateTimeFormat('nb-NO', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(value))
  }

  if (style === 'long') {
    return new Intl.DateTimeFormat('nb-NO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(new Date(value))
  }

  return new Intl.DateTimeFormat('nb-NO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

export function formatArtistDay(value: string) {
  return new Date(value).getDate()
}

export function formatArtistMonth(value: string) {
  return new Date(value).toLocaleDateString('nb-NO', { month: 'short' })
}

export function offerStatusLabel(status: string) {
  const labels: Record<string, string> = {
    sent: 'Venter på svar',
    accepted: 'Akseptert',
    declined: 'Avslått',
    expired: 'Utløpt',
    filled_by_other: 'Fylt av annen',
    cancelled: 'Kansellert',
  }
  return labels[status] ?? status.replaceAll('_', ' ')
}

export function spotStatusLabel(status: string) {
  const labels: Record<string, string> = {
    confirmed: 'Bekreftet',
    cancelled: 'Kansellert',
    pending: 'Venter',
  }
  return labels[status] ?? status
}
