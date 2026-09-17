import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Feltformen i admin-skjemaene: Show details og My club.
 *
 * `Input` er pilleformet for hele appen. I registreringsskjemaene står korte
 * felt ved siden av hverandre, og der leser den runde formen som knapper — så
 * feltene får en rolig radius her, uten at primitiven flyttes under resten av
 * appen.
 *
 * Rammen sitter rundt hele feltet og ikke på selve `<input>`: et prefiks, en
 * enhet eller en knapp står inne i den samme rammen. Da er alle felt like høye
 * og står i samme linje, uansett hva de har rundt seg.
 */
export const FIELD_FRAME_CLASS =
  'h-10 w-full min-w-0 rounded-lg border border-input bg-background shadow-xs transition-[color,box-shadow]'

/** Rammen rundt et felt. Fokus og feil leses av det som står inni. */
export const FIELD_GROUP_CLASS = cn(
  FIELD_FRAME_CLASS,
  'flex items-stretch overflow-hidden',
  'has-focus-visible:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50',
  'has-aria-invalid:border-destructive has-aria-invalid:ring-[3px] has-aria-invalid:ring-destructive/20',
)

/** `Input` inne i rammen: kant, ring og feilmarkering hører til rammen. */
export const FIELD_INPUT_CLASS =
  'h-full flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 aria-invalid:ring-0'

/**
 * En knapp som ser ut som et felt og åpner en velger: dato, valuta, lokasjoner.
 * `aria-invalid` finnes ikke for knapper, så en feil markeres med `data-invalid`.
 */
export const FIELD_TRIGGER_CLASS = cn(
  FIELD_FRAME_CLASS,
  'flex items-center justify-between gap-2 px-3 text-left text-base outline-none md:text-sm',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
  'data-[invalid=true]:border-destructive data-[invalid=true]:ring-[3px] data-[invalid=true]:ring-destructive/20',
)

/** Tekst over flere linjer, i samme ramme som feltene. Til `Textarea`. */
export const FIELD_TEXTAREA_CLASS = 'min-h-26 rounded-lg border-input bg-background py-2.5 shadow-xs'

/** Et prefiks eller en enhet i rammen: `/events/`, `seats`, valutaen. */
export const FIELD_ADDON_CLASS =
  'flex shrink-0 items-center whitespace-nowrap border-input bg-muted/50 px-3 text-sm text-muted-foreground'

/** En knapp eller lenke i rammen — kopier, åpne. Står til høyre, med strek foran. */
export const FIELD_ADDON_BUTTON_CLASS =
  'flex w-10 shrink-0 items-center justify-center border-l border-input text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-50'

/** Hjelpeteksten under et felt. Mindre enn `FieldDescription` ellers: den står ofte under korte felt side om side. */
export const FIELD_HINT_CLASS = 'text-xs'

/** Tallfelt uten piler: de endrer verdien på et uhell ved scroll. */
export const NUMBER_INPUT_CLASS =
  '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [appearance:textfield]'

/**
 * Tidsfelt uten nettleserens egen klokkeknapp. Den finnes bare i Chromium; i
 * stedet står `FieldIcon` med en klokke på samme sted i alle nettlesere. Tiden
 * skrives inn i feltet.
 */
export const TIME_INPUT_CLASS = '[&::-webkit-calendar-picker-indicator]:hidden'

/**
 * Rammen rundt et helt skjema, delt i `FieldSection`-er.
 *
 * Rutenettet i gruppene følger bredden til rammen, ikke skjermen: Show details
 * står i en halv kolonne ved siden av bookingkortet, My club i en smal kolonne
 * alene.
 */
export function FieldFrame({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('@container overflow-hidden rounded-2xl border bg-card', className)}>{children}</div>
}

/**
 * En gruppe felt: overskriften i en grå linje, feltene under i et tolvkolonners
 * rutenett. Rader med flere felt deler de samme kolonnene, så kantene flukter
 * fra gruppe til gruppe. Hvert felt setter selv hvor mange kolonner det tar.
 */
export function FieldSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="border-t first:border-t-0">
      <div className="flex h-9 items-center border-b bg-muted/50 px-4">
        <h3 id={id} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </h3>
      </div>
      <div className="grid grid-cols-12 gap-x-3 gap-y-4 p-4 pb-5">{children}</div>
    </div>
  )
}

/** Et ikon til høyre i rammen som sier hva slags felt det er. Klikk går rett i feltet. */
export function FieldIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span aria-hidden className="pointer-events-none flex shrink-0 items-center pr-3 text-muted-foreground">
      <Icon className="size-4" />
    </span>
  )
}
