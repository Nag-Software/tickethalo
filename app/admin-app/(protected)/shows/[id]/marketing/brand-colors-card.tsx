'use client'

import * as React from 'react'
import { Loader2, Sparkles, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { inkOn, isHexColor, MARKETING_PALETTE_ROLES, normalizeHex } from '@/lib/marketing/palette'
import { useMarketingAction } from './use-marketing-action'
import type { MarketingPalette } from '@/types/database'

/**
 * Merkevarefargene showet markedsføres i.
 *
 * De tre fargene brukes til AI-plakaten og som bakgrunn i eksportformatene der
 * plakaten ikke dekker hele flaten. «Suggest» leser fargene ut av designet
 * klubben allerede har — malen, plakaten eller logoen — og fyller velgerne
 * uten å lagre, slik at ingen mister et valg de har tatt bevisst.
 */

const SUGGEST_SOURCE_LABEL: Record<string, string> = {
  template: 'the selected template',
  poster: 'the current poster',
  logo: 'your club logo',
  brand: 'your club brand colour',
}

export function BrandColorsCard({
  showId,
  saved,
  saveAction,
  suggestAction,
}: {
  showId: string
  saved: MarketingPalette
  saveAction: (formData: FormData) => Promise<{ palette: MarketingPalette }>
  suggestAction: (formData: FormData) => Promise<{ palette: MarketingPalette; source: string }>
}) {
  const { run, isRunning, isPending } = useMarketingAction()

  // Lagringen går gjennom en revalidate, så `saved` kommer tilbake som en ny
  // prop og utkastet må følge etter — ellers ser kortet ulagret ut rett etter
  // lagring. Sammenligningen går på verdi, ikke identitet: `saved` er et nytt
  // objekt ved hver render, så identitet ville nullstilt utkastet mens noen
  // fortsatt skriver i det.
  const savedKey = `${saved.primary}|${saved.secondary}|${saved.accent}`
  const [state, setState] = React.useState({ key: savedKey, draft: saved })
  if (state.key !== savedKey) setState({ key: savedKey, draft: saved })
  const draft = state.draft
  const setDraft = React.useCallback(
    (next: (current: MarketingPalette) => MarketingPalette) => {
      setState((current) => ({ ...current, draft: next(current.draft) }))
    },
    [],
  )

  const isDirty = MARKETING_PALETTE_ROLES.some((role) => draft[role.key] !== saved[role.key])
  const isValid = MARKETING_PALETTE_ROLES.every((role) => isHexColor(draft[role.key]))

  function update(key: keyof MarketingPalette, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function suggest() {
    const formData = new FormData()
    formData.set('show_id', showId)
    run('suggest', () => suggestAction(formData), {
      skipRefresh: true,
      onSuccess: (result) => setDraft(() => result.palette),
      success: (result) => `Palette suggested from ${SUGGEST_SOURCE_LABEL[result.source] ?? 'your brand'}.`,
    })
  }

  function save() {
    const formData = new FormData()
    formData.set('show_id', showId)
    for (const role of MARKETING_PALETTE_ROLES) {
      formData.set(role.key, normalizeHex(draft[role.key], saved[role.key]))
    }
    run('save', () => saveAction(formData), { success: 'Brand colours saved.' })
  }

  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Brand colours</h2>
          <p className="text-xs text-muted-foreground">Used by AI posters and export backgrounds.</p>
        </div>
        <Button variant="outline" size="sm" onClick={suggest} disabled={isPending}>
          {isRunning('suggest') ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          Suggest
        </Button>
      </header>

      <div className="space-y-3 p-4">
        <div
          className="flex h-16 overflow-hidden rounded-lg border"
          role="img"
          aria-label={`Palette preview: ${draft.primary}, ${draft.secondary}, ${draft.accent}`}
        >
          {MARKETING_PALETTE_ROLES.map((role) => (
            <div
              key={role.key}
              className="flex flex-1 items-end p-2 text-[10px] font-semibold uppercase tracking-wide transition-colors"
              style={{
                backgroundColor: isHexColor(draft[role.key]) ? draft[role.key] : 'transparent',
                color: inkOn(draft[role.key]),
              }}
            >
              {role.label}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          {MARKETING_PALETTE_ROLES.map((role) => {
            const value = draft[role.key]
            const valid = isHexColor(value)

            return (
              <div key={role.key} className="flex items-center gap-2.5">
                <label className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-lg border">
                  <span
                    className="block size-full"
                    style={{ backgroundColor: valid ? value : 'var(--muted)' }}
                    aria-hidden
                  />
                  <input
                    type="color"
                    value={valid ? value : '#000000'}
                    onChange={(event) => update(role.key, event.currentTarget.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label={`${role.label} colour`}
                  />
                </label>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{role.label}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{role.hint}</p>
                </div>

                <input
                  type="text"
                  value={value}
                  spellCheck={false}
                  onChange={(event) => update(role.key, event.currentTarget.value)}
                  onBlur={(event) => update(role.key, normalizeHex(event.currentTarget.value, saved[role.key]))}
                  aria-invalid={!valid}
                  className="h-8 w-24 shrink-0 rounded-md border bg-background px-2 font-mono text-xs uppercase aria-invalid:border-destructive"
                />
              </div>
            )
          })}
        </div>

        {isDirty && (
          <div className="flex items-center gap-2 border-t pt-3">
            <Button size="sm" onClick={save} disabled={!isValid || isPending}>
              {isRunning('save') && <Loader2 className="animate-spin" aria-hidden />}
              Save colours
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDraft(() => saved)} disabled={isPending}>
              <Undo2 aria-hidden />
              Discard
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
