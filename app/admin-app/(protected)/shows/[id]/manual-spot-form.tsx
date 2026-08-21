'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { addManualSpotAction, type ManualSpotActionState } from '../actions'

type ManualSpotArtist = {
  id: string
  full_name: string
  stage_name: string | null
  admin_score: number | null
  admin_energy_level: string | null
}

type ManualSpotRequirement = {
  id: string
  role_name: string
  quantity: number
  filled: number
}

const initialState: ManualSpotActionState = {
  status: 'idle',
  message: null,
  submittedAt: null,
}

export function ManualSpotForm({
  showId,
  currency,
  artists,
  requirements,
}: {
  showId: string
  currency: string
  artists: ManualSpotArtist[]
  requirements: ManualSpotRequirement[]
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const lastToastRef = useRef<number | null>(null)
  const [state, formAction, isPending] = useActionState(addManualSpotAction, initialState)

  useEffect(() => {
    if (!state.submittedAt || state.submittedAt === lastToastRef.current || !state.message) return
    lastToastRef.current = state.submittedAt

    if (state.status === 'success') {
      toast.success(state.message)
      formRef.current?.reset()
      router.refresh()
      return
    }

    if (state.status === 'error') {
      toast.error(state.message)
    }
  }, [router, state])

  return (
    <form ref={formRef} action={formAction} className="grid grid-cols-1 gap-3 md:grid-cols-6">
      <input type="hidden" name="show_id" value={showId} />
      <label className="space-y-1 md:col-span-2">
        <span className="text-xs font-medium text-muted-foreground">Artist</span>
        <select name="artist_id" required disabled={isPending} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60">
          <option value="">Velg artist</option>
          {artists.map(artist => (
            <option key={artist.id} value={artist.id}>
              {artist.stage_name ?? artist.full_name} · score {artist.admin_score ?? '—'} · {artist.admin_energy_level ?? 'energi ukjent'}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 md:col-span-2">
        <span className="text-xs font-medium text-muted-foreground">Rolle/krav</span>
        <select name="show_requirement_id" required disabled={isPending} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60">
          <option value="">Velg rolle</option>
          {requirements.map(req => (
            <option key={req.id} value={req.id}>{req.role_name} ({req.filled}/{req.quantity})</option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Fee</span>
        <input name="fee_amount" type="number" min={0} step="0.01" placeholder="0" disabled={isPending} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60" />
      </label>
      <label className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Valuta</span>
        <input name="currency" defaultValue={currency} disabled={isPending} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60" />
      </label>
      <div className="flex justify-end md:col-span-6">
        <button type="submit" disabled={isPending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60">
          {isPending ? 'Legger til...' : 'Legg til i lineup'}
        </button>
      </div>
    </form>
  )
}