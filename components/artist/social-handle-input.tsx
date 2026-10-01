import { cn } from '@/lib/utils'

/**
 * Brukernavn-felt med «@» foran. Komikeren skriver bare navnet; serveren gjør
 * det om til lenken (`lib/social-links.ts`). En limt inn lenke forstås også,
 * så feltet er tekst, ikke `type="url"`.
 */
export function SocialHandleInput({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px] text-[var(--ev-faint)]"
      >
        @
      </span>
      <input
        type="text"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        pattern="\S+"
        title="Just your username, without spaces — like tomsoyler"
        className={cn(className, 'pl-[1.85rem]')}
        {...props}
      />
    </div>
  )
}
