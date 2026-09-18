'use client'

import { useId, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { FIELD_GROUP_CLASS, FIELD_HINT_CLASS, FIELD_INPUT_CLASS } from '@/components/admin/form-fields'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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

const emptyDraft = (): LocationDraft => ({ key: crypto.randomUUID(), id: null, name: '', addressLine: '' })

/**
 * The club's venues: a name and an address per row, in the open.
 *
 * These are what the Venue field on a show searches in, and a show that picks
 * one stays linked to it — so a row here is edited in place, not removed and
 * re-added. The list used to sit inside a dropdown that could only add and
 * remove; the address was easy to skip and impossible to correct, and nothing
 * said what the list was for.
 *
 * The field is saved together with the rest of the club profile. Each row
 * submits `locationId`, `locationName` and `locationAddress`; the action reads
 * them as parallel lists, so every row must carry all three.
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
  const [drafts, setDrafts] = useState<LocationDraft[]>(() =>
    locations.length > 0
      ? locations.map((location) => ({
          key: location.id,
          id: location.id,
          name: location.name,
          addressLine: location.address_line ?? '',
        }))
      : [emptyDraft()],
  )

  function update(key: string, patch: Partial<Pick<LocationDraft, 'name' | 'addressLine'>>) {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))
  }

  function remove(key: string) {
    // Den siste raden tømmes i stedet for å forsvinne, så det alltid er et sted å skrive.
    setDrafts((current) => (current.length === 1 ? [emptyDraft()] : current.filter((draft) => draft.key !== key)))
  }

  return (
    <Field className={cn('col-span-12 min-w-0 gap-1.5', className)}>
      <FieldLabel id={`${fieldId}-label`}>Venues</FieldLabel>

      <ul aria-labelledby={`${fieldId}-label`} className="space-y-2">
        {drafts.map((draft, index) => {
          const number = index + 1
          return (
            <li key={draft.key} className="grid grid-cols-1 items-start gap-2 @md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
              <input type="hidden" name="locationId" value={draft.id ?? ''} />
              <div className={FIELD_GROUP_CLASS}>
                <Input
                  name="locationName"
                  value={draft.name}
                  onChange={(event) => update(draft.key, { name: event.target.value })}
                  placeholder="Venue name"
                  aria-label={`Venue ${number} name`}
                  className={FIELD_INPUT_CLASS}
                />
              </div>
              <div className={FIELD_GROUP_CLASS}>
                <Input
                  name="locationAddress"
                  value={draft.addressLine}
                  onChange={(event) => update(draft.key, { addressLine: event.target.value })}
                  placeholder="Street, postcode and city"
                  aria-label={`Venue ${number} address`}
                  // Et nytt sted uten adresse er et halvt sted: det er adressen
                  // komikeren og billettkjøperen trenger. Eldre rader uten
                  // adresse får stå, så profilen kan lagres uten at de rettes først.
                  required={draft.id === null && draft.name.trim().length > 0}
                  className={FIELD_INPUT_CLASS}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(draft.key)}
                className="text-muted-foreground"
              >
                <X aria-hidden />
                <span className="sr-only">Remove {draft.name || `venue ${number}`}</span>
              </Button>
            </li>
          )
        })}
      </ul>

      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setDrafts((current) => [...current, emptyDraft()])}>
          <Plus data-icon="inline-start" />
          Add venue
        </Button>
      </div>

      <FieldDescription className={FIELD_HINT_CLASS}>
        The venues you pick from when you create a show, and what the club page shows with a map link. Correct a name or
        an address here and your upcoming shows at that venue follow. Removing a venue leaves its shows as they are.
      </FieldDescription>
    </Field>
  )
}
