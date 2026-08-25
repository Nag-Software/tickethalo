'use client'

import * as React from 'react'
import Image from 'next/image'
import { ImagePlus, Loader2, RotateCcw, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MARKETING_DESIGN_ACCEPT } from '@/lib/marketing/storage'
import { useMarketingAction } from './use-marketing-action'
import type { MarketingSlot } from '@/lib/marketing/slots'

/**
 * Bilderutene i malen, med bookingen som fyller hver av dem.
 *
 * Rutene er allerede matchet mot lineupen når kortet tegnes — «Headliner»-ruten
 * peker på headlineren. Dette er stedet klubben overstyrer den matchingen: bytte
 * hvem som står i en rute, eller legge inn et bedre pressebilde enn profilbildet
 * artisten selv har lastet opp.
 */

export type SlotArtistOption = {
  id: string
  name: string
  roleLabel: string | null
  profileImageUrl: string | null
}

export function SlotMatcher({
  showId,
  slots,
  artistOptions,
  templateSlotCount,
  setArtistAction,
  uploadImageAction,
  clearImageAction,
  resetAction,
}: {
  showId: string
  slots: MarketingSlot[]
  artistOptions: SlotArtistOption[]
  templateSlotCount: number | null
  setArtistAction: (formData: FormData) => Promise<void>
  uploadImageAction: (formData: FormData) => Promise<{ imageUrl: string }>
  clearImageAction: (formData: FormData) => Promise<void>
  resetAction: (formData: FormData) => Promise<void>
}) {
  const { run, isRunning, isPending } = useMarketingAction()
  const hasManualSlots = slots.some((slot) => slot.isManual || slot.hasCustomImage)
  const missingImages = slots.filter((slot) => slot.artistId && !slot.imageUrl).length

  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Photo slots</h2>
          <p className="text-xs text-muted-foreground">
            {templateSlotCount
              ? `Matched to the template's ${templateSlotCount} slots.`
              : 'Matched to the booked lineup.'}
          </p>
        </div>
        {hasManualSlots && (
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => {
              if (!window.confirm('Reset every slot back to the automatic lineup match?')) return
              const formData = new FormData()
              formData.set('show_id', showId)
              run('reset', () => resetAction(formData), { success: 'Slots reset to the lineup.' })
            }}
          >
            {isRunning('reset') ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
            Reset
          </Button>
        )}
      </header>

      {missingImages > 0 && (
        <p className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          {missingImages} {missingImages === 1 ? 'artist has' : 'artists have'} no photo. Upload one per slot, or the
          poster will fall back to typography for them.
        </p>
      )}

      <ul className="divide-y">
        {slots.map((slot) => (
          <SlotRow
            key={slot.slotIndex}
            showId={showId}
            slot={slot}
            artistOptions={artistOptions}
            run={run}
            isRunning={isRunning}
            isPending={isPending}
            setArtistAction={setArtistAction}
            uploadImageAction={uploadImageAction}
            clearImageAction={clearImageAction}
          />
        ))}

        {slots.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">
            No booked artists yet. Slots appear as the lineup fills up.
          </li>
        )}
      </ul>
    </section>
  )
}

type RunFn = ReturnType<typeof useMarketingAction>['run']

function SlotRow({
  showId,
  slot,
  artistOptions,
  run,
  isRunning,
  isPending,
  setArtistAction,
  uploadImageAction,
  clearImageAction,
}: {
  showId: string
  slot: MarketingSlot
  artistOptions: SlotArtistOption[]
  run: RunFn
  isRunning: (key: string) => boolean
  isPending: boolean
  setArtistAction: (formData: FormData) => Promise<void>
  uploadImageAction: (formData: FormData) => Promise<{ imageUrl: string }>
  clearImageAction: (formData: FormData) => Promise<void>
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const key = `slot-${slot.slotIndex}`
  const busy = isRunning(key)

  function baseFormData() {
    const formData = new FormData()
    formData.set('show_id', showId)
    formData.set('slot_index', String(slot.slotIndex))
    formData.set('role_label', slot.roleLabel)
    return formData
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="relative size-12 shrink-0 overflow-hidden rounded-lg border bg-muted/30">
        {slot.imageUrl ? (
          <Image src={slot.imageUrl} alt={slot.artistName ?? slot.roleLabel} fill sizes="48px" className="object-cover" />
        ) : (
          <span className="grid size-full place-content-center text-muted-foreground">
            <User className="size-4" aria-hidden />
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 grid place-content-center bg-background/70">
            <Loader2 className="size-4 animate-spin" aria-hidden />
          </span>
        )}
        {slot.hasCustomImage && !busy && (
          <span
            className="absolute inset-x-0 bottom-0 bg-primary/90 py-px text-center text-[8px] font-bold uppercase text-primary-foreground"
            title="Custom photo for this poster"
          >
            Custom
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{slot.roleLabel}</p>
        <select
          value={slot.artistId ?? ''}
          disabled={isPending}
          className="h-8 w-full rounded-md border bg-background px-2 text-xs"
          onChange={(event) => {
            const formData = baseFormData()
            formData.set('artist_id', event.currentTarget.value)
            run(key, () => setArtistAction(formData), { success: 'Slot updated.' })
          }}
        >
          <option value="">— Leave empty —</option>
          {artistOptions.map((artist) => (
            <option key={artist.id} value={artist.id}>
              {artist.name}{artist.roleLabel ? ` · ${artist.roleLabel}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <input
          ref={inputRef}
          type="file"
          accept={MARKETING_DESIGN_ACCEPT}
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (!file) return
            const formData = baseFormData()
            formData.set('slot_image', file)
            if (slot.artistId) formData.set('artist_id', slot.artistId)
            run(key, () => uploadImageAction(formData), { success: 'Photo updated.' })
          }}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={isPending}
          title="Upload a photo for this slot"
          aria-label={`Upload a photo for ${slot.roleLabel}`}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus aria-hidden />
        </Button>
        {slot.hasCustomImage && (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isPending}
            title="Back to the artist's profile photo"
            aria-label={`Remove the custom photo for ${slot.roleLabel}`}
            onClick={() => run(key, () => clearImageAction(baseFormData()), { success: 'Back to the profile photo.' })}
          >
            <X aria-hidden />
          </Button>
        )}
      </div>
    </li>
  )
}
