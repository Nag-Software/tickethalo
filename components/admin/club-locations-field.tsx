'use client'

import { useId, useState } from 'react'
import { ChevronDown, MapPin, Plus, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ClubLocation } from '@/types/database'

type LocationDraft = {
  /** Stable key for React. Not the same as the database row. */
  key: string
  /** Null for locations that have not been saved yet. */
  id: string | null
  name: string
  addressLine: string
}

/**
 * A club's locations, as a single dropdown.
 *
 * The field is saved together with the rest of the club profile: the rows sit
 * as hidden inputs in the form, not as separate calls. That is why the hidden
 * inputs live outside the popover — Radix moves the popover content out of the
 * form in the DOM, and inputs that end up there are never submitted.
 */
export function ClubLocationsField({
  locations,
}: {
  locations: Array<Pick<ClubLocation, 'id' | 'name' | 'address_line'>>
}) {
  const fieldId = useId()
  const [drafts, setDrafts] = useState<LocationDraft[]>(() =>
    locations.map((location) => ({
      key: location.id,
      id: location.id,
      name: location.name,
      addressLine: location.address_line ?? '',
    })),
  )
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')

  function addLocation() {
    const name = newName.trim()
    if (!name) return

    setDrafts((current) => [
      ...current,
      { key: crypto.randomUUID(), id: null, name, addressLine: newAddress.trim() },
    ])
    setNewName('')
    setNewAddress('')
  }

  /**
   * Enter adds the row. `preventDefault` because the inputs live in a portal
   * outside the form — without it the keypress would just fall through.
   */
  function submitOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    addLocation()
  }

  function removeLocation(key: string) {
    setDrafts((current) => current.filter((draft) => draft.key !== key))
  }

  const summary =
    drafts.length === 0
      ? 'No locations'
      : drafts.length === 1
        ? drafts[0].name
        : `${drafts[0].name} +${drafts.length - 1}`

  return (
    <div className="space-y-2">
      {/* The values actually submitted. The order here is the order they get. */}
      {drafts.map((draft) => (
        <div key={draft.key}>
          <input type="hidden" name="locationId" value={draft.id ?? ''} />
          <input type="hidden" name="locationName" value={draft.name} />
          <input type="hidden" name="locationAddress" value={draft.addressLine} />
        </div>
      ))}

      <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
        Locations
      </label>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={fieldId}
            type="button"
            className="flex h-11 w-full items-center gap-2.5 rounded-2xl bg-zinc-100/80 px-4 text-left text-sm transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
          >
            <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={drafts.length === 0 ? 'flex-1 truncate text-muted-foreground' : 'flex-1 truncate'}>
              {summary}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {drafts.length > 0 && `${drafts.length}`}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] gap-0 p-0">
          {drafts.length > 0 && (
            <ul className="max-h-64 overflow-y-auto p-2">
              {drafts.map((draft) => (
                <li
                  key={draft.key}
                  className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-zinc-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{draft.name}</span>
                    {draft.addressLine && (
                      <span className="block truncate text-xs text-muted-foreground">{draft.addressLine}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLocation(draft.key)}
                    className="grid size-7 shrink-0 place-content-center rounded-full text-muted-foreground transition-colors hover:bg-zinc-200 hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden />
                    <span className="sr-only">Remove {draft.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className={drafts.length > 0 ? 'border-t border-zinc-100 p-3' : 'p-3'}>
            <div className="space-y-2">
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={submitOnEnter}
                placeholder="Location name"
                className="h-9 w-full rounded-xl bg-zinc-100/80 px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:bg-zinc-100"
              />
              <input
                value={newAddress}
                onChange={(event) => setNewAddress(event.target.value)}
                onKeyDown={submitOnEnter}
                placeholder="Address (optional)"
                className="h-9 w-full rounded-xl bg-zinc-100/80 px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:bg-zinc-100"
              />
              <button
                type="button"
                onClick={addLocation}
                disabled={newName.trim().length === 0}
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-30"
              >
                <Plus className="size-4" aria-hidden />
                Add location
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <p className="text-xs text-muted-foreground">
        The venues the club plays. Shown on the club page with a map link.
      </p>
    </div>
  )
}
