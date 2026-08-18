import { cn } from '@/lib/utils'

/**
 * Delte byggeklosser for komikerportalen.
 *
 * Portalen brukte tre ulike visuelle språk: brutalistiske rammer på
 * oversikten, rå shadcn-Cards på undersidene, og cream + rød på
 * innloggingen. Disse komponentene leser `.ev-surface`-variablene, så
 * portalen ser ut som resten av humor.events uten at hver side må
 * gjenta de samme klassene.
 */

/** Overskriften øverst på hver portalside. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-[var(--ev-line)] pb-5">
      <div className="min-w-0">
        <h1 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.025em] sm:text-[1.75rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-[14px] leading-relaxed text-[var(--ev-muted)]">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Flate uten ramme — dybde kommer fra tinting, ikke streker. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn('flex flex-col gap-5 bg-[var(--ev-card)] p-5 sm:p-6', className)}
      style={{ borderRadius: 'var(--ev-r-card)' }}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
            )}
            {description && (
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--ev-muted)]">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

/** Rad i en liste inne i et Panel. */
export function Row({
  children,
  className,
  muted,
}: {
  children: React.ReactNode
  className?: string
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-5 gap-y-3 bg-[var(--ev-bg)] px-4 py-3.5',
        muted && 'opacity-55',
        className
      )}
      style={{ borderRadius: 'var(--ev-r-art)' }}
    >
      {children}
    </div>
  )
}

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'accent' | 'ink'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap px-2.5 py-1 text-[12px] font-medium',
        tone === 'accent' && 'bg-[var(--ev-accent-fill)] text-[var(--ev-accent-ink)]',
        tone === 'ink' && 'bg-[var(--ev-text)] text-[var(--ev-bg)]',
        tone === 'neutral' && 'bg-[var(--ev-card-hover)] text-[var(--ev-muted)]'
      )}
      style={{ borderRadius: 'var(--ev-r-chip)' }}
    >
      {children}
    </span>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="border border-dashed border-[var(--ev-line-strong)] px-5 py-10 text-center text-[14px] text-[var(--ev-muted)]"
      style={{ borderRadius: 'var(--ev-r-art)' }}
    >
      {children}
    </div>
  )
}

/** Etikett/verdi-par, brukt i sidepaneler. */
export function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="shrink-0 text-[13px] text-[var(--ev-faint)]">{label}</span>
      <span className="truncate text-right text-[14px] font-medium">{value}</span>
    </div>
  )
}

/**
 * Knappeklasser som strenger, ikke komponenter — mange av dem sitter på
 * `<Link>` eller `<button type="submit">` inne i en server action-form.
 */
export const portalButton = {
  primary: cn(
    'inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors',
    'bg-[var(--ev-text)] text-[var(--ev-bg)]',
    'hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
    'disabled:cursor-not-allowed disabled:bg-[var(--ev-card-hover)] disabled:text-[var(--ev-faint)] disabled:hover:bg-[var(--ev-card-hover)]'
  ),
  secondary: cn(
    'inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors',
    'text-[var(--ev-muted)] ring-1 ring-inset ring-[var(--ev-line-strong)]',
    'hover:text-[var(--ev-text)] hover:ring-[var(--ev-text)]',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
    'disabled:cursor-not-allowed disabled:opacity-50'
  ),
}
