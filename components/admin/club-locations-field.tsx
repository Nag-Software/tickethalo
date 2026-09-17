'use client'

import { Fragment, useId, useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import {
  FIELD_GROUP_CLASS,
  FIELD_HINT_CLASS,
  FIELD_INPUT_CLASS,
  FIELD_TRIGGER_CLASS,
} from '@/components/admin/form-fields'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
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
  className,
}: {
  locations: Array<Pick<ClubLocation, 'id' | 'name' | 'address_line'>>
  /** Kolonnene feltet tar i `FieldSection`-rutenettet. */
  className?: string
}) {
  const fieldId = useId()
  const labelId = `${fieldId}-label`
  const summaryId = `${fieldId}-summary`
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
    <Field className={cn('col-span-12 min-w-0 gap-1.5', className)}>
      {/* The values actually submitted. The order here is the order they get.
          No wrapper element: the field is a flex column, and empty wrappers
          would each add a gap. */}
      {drafts.map((draft) => (
        <Fragment key={draft.key}>
          <input type="hidden" name="locationId" value={draft.id ?? ''} />
          <input type="hidden" name="locationName" value={draft.name} />
          <input type="hidden" name="locationAddress" value={draft.addressLine} />
        </Fragment>
      ))}

      <FieldLabel id={labelId} htmlFor={fieldId}>
        Locations
      </FieldLabel>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={fieldId}
            type="button"
            // The label alone would name the button "Locations" without saying which.
            aria-labelledby={`${labelId} ${summaryId}`}
            className={FIELD_TRIGGER_CLASS}
          >
            <span id={summaryId} className={cn('min-w-0 flex-1 truncate', drafts.length === 0 && 'text-muted-foreground')}>
              {summary}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] gap-0 p-0">
          {drafts.length > 0 && (
            <ul className="max-h-64 overflow-y-auto p-1.5">
              {drafts.map((draft) => (
                <li key={draft.key} className="flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{draft.name}</span>
                    {draft.addressLine && (
                      <span className="block truncate text-xs text-muted-foreground">{draft.addressLine}</span>
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeLocation(draft.key)}
                    className="text-muted-foreground"
                  >
                    <X aria-hidden />
                    <span className="sr-only">Remove {draft.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className={cn('space-y-2 p-3', drafts.length > 0 && 'border-t')}>
            <div className={FIELD_GROUP_CLASS}>
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={submitOnEnter}
                placeholder="Location name"
                aria-label="Location name"
                className={FIELD_INPUT_CLASS}
              />
            </div>
            <div className={FIELD_GROUP_CLASS}>
              <Input
                value={newAddress}
                onChange={(event) => setNewAddress(event.target.value)}
                onKeyDown={submitOnEnter}
                placeholder="Address (optional)"
                aria-label="Address"
                className={FIELD_INPUT_CLASS}
              />
            </div>
            <Button type="button" onClick={addLocation} disabled={newName.trim().length === 0} className="w-full">
              <Plus data-icon="inline-start" />
              Add location
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <FieldDescription className={FIELD_HINT_CLASS}>
        The venues the club plays. Shown on the club page with a map link.
      </FieldDescription>
    </Field>
  )
}
