'use client'

import { useState } from 'react'
import { Check, ChevronDown, Languages as LanguagesIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { LANGUAGES, formatLanguageSummary, type LanguageCode } from '@/lib/languages'

/**
 * Flervalg av språk, som nedtrekk.
 *
 * Ikke `<select multiple>`: den krever ctrl-klikk for å velge mer enn ett,
 * noe nesten ingen vet, og er tilnærmet ubrukelig på mobil.
 *
 * Ikke tretten chips på rad heller — det ble en vegg av knapper for et felt
 * de fleste svarer «norsk» på. Valgene ligger bak samme slags knapp som
 * stedvelgeren, og det valgte oppsummeres i knappen, så feltet tar én linje
 * uansett hvor mange språk som er huket av.
 */
export function LanguageField({
  value,
  onChange,
  suggestedFrom,
  id = 'language',
}: {
  value: LanguageCode[]
  onChange: (next: LanguageCode[]) => void
  /** Landet forslaget kom fra, så forhåndsvalget ikke ser tilfeldig ut. */
  suggestedFrom?: string | null
  id?: string
}) {
  const [open, setOpen] = useState(false)

  const toggle = (code: LanguageCode) => {
    onChange(value.includes(code) ? value.filter((item) => item !== code) : [...value, code])
  }

  const summary = formatLanguageSummary(value)

  return (
    <div className="space-y-1.5">
      {/* Vanlig form-post, så hvert valgte språk trenger sitt eget felt. */}
      {value.map((code) => (
        <input key={code} type="hidden" name="language" value={code} />
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-label={summary ? `Language: ${summary}. Change` : 'Select languages'}
            className={cn(
              'flex h-11 w-full items-center gap-2 rounded-xl bg-[var(--ev-bg)] px-3.5 text-left text-[14px]',
              'outline-none ring-1 ring-inset ring-[var(--ev-line)] transition-[box-shadow]',
              'focus-visible:ring-2 focus-visible:ring-[var(--ev-accent-fill)]'
            )}
          >
            <LanguagesIcon className="size-4 shrink-0 text-[var(--ev-faint)]" aria-hidden />
            <span className={cn('min-w-0 flex-1 truncate', !summary && 'text-[var(--ev-faint)]')}>
              {summary || 'Select Languages'}
            </span>
            {value.length > 1 && (
              <span className="shrink-0 rounded-full bg-[var(--ev-card-hover)] px-2 py-0.5 text-[12px] tabular-nums text-[var(--ev-muted)]">
                {value.length}
              </span>
            )}
            <ChevronDown
              className={cn('size-4 shrink-0 text-[var(--ev-faint)] transition-transform', open && 'rotate-180')}
              aria-hidden
            />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="max-h-[var(--radix-popover-content-available-height)] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl bg-[var(--ev-bg)] p-1.5 text-[var(--ev-text)] ring-1 ring-[var(--ev-line-strong)]"
          style={{ zIndex: 100 }}
        >
          <div role="group" aria-label="Languages">
            {LANGUAGES.map((language) => {
              const checked = value.includes(language.code)
              return (
                <button
                  key={language.code}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggle(language.code)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] transition-colors hover:bg-[var(--ev-card-hover)]"
                >
                  <span
                    className={cn(
                      'grid size-4 shrink-0 place-content-center rounded border transition-colors',
                      checked
                        ? 'border-[var(--ev-accent-fill)] bg-[var(--ev-accent-fill)] text-[var(--ev-accent-ink)]'
                        : 'border-[var(--ev-line-strong)]'
                    )}
                    aria-hidden
                  >
                    {checked && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{language.label}</span>
                  <span className="shrink-0 text-[12px] text-[var(--ev-faint)]">{language.native}</span>
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>

      {suggestedFrom && (
        <p className="text-[12px] text-[var(--ev-faint)]">
          Suggested from {suggestedFrom}. Change it if you perform in other languages.
        </p>
      )}
    </div>
  )
}
