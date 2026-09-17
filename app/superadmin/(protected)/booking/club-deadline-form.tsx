'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { setClubLineupDeadlineAction } from './actions'

type State = { error: string } | undefined

/**
 * Lineup-fristen for én klubb, med feilmeldingen ved raden den gjelder.
 *
 * `useActionState` og ikke en kastet feil: Next skjuler meldingen i en
 * kastet feil i produksjon, og «må være mellom 1 og 120» er nettopp det den
 * som skriver inn 400 trenger å se.
 */
export function ClubDeadlineForm({
  clubId,
  clubName,
  value,
  placeholder,
}: {
  clubId: string
  clubName: string
  value: number | null
  placeholder: number
}) {
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, formData) => setClubLineupDeadlineAction(formData),
    undefined,
  )

  return (
    <form action={formAction} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="club_id" value={clubId} />
      {state?.error && (
        <span role="alert" className="mr-auto text-[12.5px] font-medium text-destructive">
          {state.error}
        </span>
      )}
      <Input
        name="lineup_deadline_days"
        type="number"
        min={1}
        max={120}
        step={1}
        defaultValue={value ?? ''}
        placeholder={String(placeholder)}
        aria-label={`Lineup-frist for ${clubName}, i dager`}
        aria-invalid={Boolean(state?.error)}
        className="h-8 w-24 text-right"
      />
      <span className="text-xs text-muted-foreground">dager før showet</span>
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? 'Lagrer …' : 'Lagre'}
      </Button>
    </form>
  )
}
