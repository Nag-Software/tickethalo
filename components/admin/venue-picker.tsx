'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { Link2, MapPin } from 'lucide-react'
import { FIELD_GROUP_CLASS, FIELD_HINT_CLASS, FIELD_INPUT_CLASS, FieldIcon } from '@/components/admin/form-fields'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { isLinkedTo, searchLocations, type VenueLocation } from '@/lib/show-venue'

export type VenuePickerValue = {
  venue_name: string
  venue_address: string
  /** Tom streng = ikke lenket. Skjemafelt er strenger hele veien. */
  club_location_id: string
  /** 'true' når bookeren vil ha stedet lagret under My club. */
  save_location: string
}

export const EMPTY_VENUE: VenuePickerValue = { venue_name: '', venue_address: '', club_location_id: '', save_location: '' }

/**
 * Stedet på et show: Venue og Address, to felt.
 *
 * Venue er en søkbar liste over lokasjonene klubben har ført under My club —
 * søket treffer både navn og adresse. Et valg fyller begge feltene og lenker
 * showet til lokasjonen, så en rettelse under My club følger med på kommende
 * show. Alt annet er fritekst: et gjestespill et annet sted trenger ingen
 * lagret lokasjon, men kan bli det med en avkrysning.
 *
 * Skriver bookeren om navnet eller adressen på et lenket show, løses lenken.
 * Det er med vilje: da er det ikke lenger den lagrede lokasjonen, og My club
 * skal ikke skrive over det som ble skrevet for hånd.
 *
 * Feltene har `name`, så komponenten virker i et vanlig skjema uten noe mer.
 * Et skjema som lagrer selv, sender `value` og `onChange`.
 */
export function VenuePicker({
  locations,
  defaultValue = EMPTY_VENUE,
  value,
  onChange,
  className,
}: {
  locations: VenueLocation[]
  defaultValue?: VenuePickerValue
  value?: VenuePickerValue
  onChange?: (next: VenuePickerValue) => void
  /** Kolonnene hvert felt tar i rutenettet det står i. */
  className?: string
}) {
  const id = useId()
  const listId = `${id}-locations`
  const [inner, setInner] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const current = value ?? inner

  function set(next: VenuePickerValue) {
    setInner(next)
    onChange?.(next)
  }

  const linkedLocation = current.club_location_id
    ? locations.find((location) => location.id === current.club_location_id) ?? null
    : null
  const linked = Boolean(linkedLocation && isLinkedTo(current, linkedLocation))

  // Et lenket felt viser hele lista når det åpnes — da bytter man sted, man
  // søker ikke på navnet som allerede står der.
  const matches = searchLocations(locations, linked ? '' : current.venue_name)
  const canSave = !linked && current.venue_name.trim().length > 0

  function choose(location: VenueLocation) {
    set({
      venue_name: location.name,
      venue_address: location.address_line ?? '',
      club_location_id: location.id,
      save_location: '',
    })
    setOpen(false)
  }

  /** Tekst skrevet for hånd. Lenken står bare så lenge teksten er lokasjonens egen. */
  function edit(patch: Partial<Pick<VenuePickerValue, 'venue_name' | 'venue_address'>>) {
    const next = { ...current, ...patch }
    const stillLinked = linkedLocation ? isLinkedTo(next, linkedLocation) : false
    set({ ...next, club_location_id: stillLinked ? current.club_location_id : '', save_location: stillLinked ? '' : current.save_location })
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') return setOpen(false)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) return setOpen(true)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((index) => (matches.length === 0 ? 0 : (index + step + matches.length) % matches.length))
      return
    }
    // Enter velger bare når lista er åpen og noe er markert — ellers er Enter
    // skjemaets egen («lagre nå»).
    if (event.key === 'Enter' && open && matches[active]) {
      event.preventDefault()
      choose(matches[active])
    }
  }

  return (
    <>
      <input type="hidden" name="club_location_id" value={linked ? current.club_location_id : ''} />

      <Field className={cn('min-w-0 gap-1.5', className)}>
        <FieldLabel htmlFor={`${id}-venue`}>Venue</FieldLabel>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverAnchor asChild>
            <div className={FIELD_GROUP_CLASS}>
              <Input
                id={`${id}-venue`}
                name="venue_name"
                role="combobox"
                aria-expanded={open}
                aria-controls={listId}
                aria-autocomplete="list"
                autoComplete="off"
                value={current.venue_name}
                onChange={(event) => {
                  edit({ venue_name: event.target.value })
                  setActive(0)
                  setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={onKeyDown}
                placeholder={locations.length > 0 ? 'Search your locations, or type a venue' : 'Venue name'}
                className={FIELD_INPUT_CLASS}
              />
              <FieldIcon icon={MapPin} />
            </div>
          </PopoverAnchor>

          <PopoverContent
            align="start"
            // Feltet beholder fokus: lista er et forslag, ikke en dialog.
            onOpenAutoFocus={(event) => event.preventDefault()}
            onInteractOutside={(event) => {
              if ((event.target as HTMLElement | null)?.id === `${id}-venue`) event.preventDefault()
            }}
            className="w-[var(--radix-popover-trigger-width)] gap-0 rounded-xl p-0"
          >
            {matches.length > 0 ? (
              <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1.5">
                {matches.map((location, index) => (
                  <li
                    key={location.id}
                    role="option"
                    aria-selected={location.id === current.club_location_id && linked}
                    // mousedown, ikke click: et klikk tar fokus fra feltet
                    // først, og da lagrer skjemaet det halvskrevne søket.
                    onMouseDown={(event) => {
                      event.preventDefault()
                      choose(location)
                    }}
                    onMouseEnter={() => setActive(index)}
                    className={cn('cursor-pointer rounded-lg px-2.5 py-2', index === active && 'bg-muted/60')}
                  >
                    <span className="block truncate text-sm">{location.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {location.address_line || 'No address saved'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p id={listId} className="px-3 py-3 text-xs text-muted-foreground">
                {locations.length === 0
                  ? 'No saved locations yet. Type the venue here, or add your venues under My club.'
                  : 'No saved location matches. This will be used as typed.'}
              </p>
            )}
            <div className="border-t px-3 py-2">
              <Link href="/admin-app/my-club" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                Manage locations in My club
              </Link>
            </div>
          </PopoverContent>
        </Popover>
      </Field>

      <Field className={cn('min-w-0 gap-1.5', className)}>
        <FieldLabel htmlFor={`${id}-address`}>Address</FieldLabel>
        <div className={FIELD_GROUP_CLASS}>
          <Input
            id={`${id}-address`}
            name="venue_address"
            autoComplete="off"
            value={current.venue_address}
            onChange={(event) => edit({ venue_address: event.target.value })}
            placeholder="Street, postcode and city"
            className={FIELD_INPUT_CLASS}
          />
        </div>

        {linked && (
          <FieldDescription className={cn(FIELD_HINT_CLASS, 'flex items-center gap-1.5')}>
            <Link2 className="size-3.5 shrink-0" aria-hidden />
            Linked to My club — a change there updates this show. Editing here unlinks it.
          </FieldDescription>
        )}

        {canSave && (
          <label className={cn(FIELD_HINT_CLASS, 'flex items-center gap-2 text-muted-foreground')}>
            <input
              type="checkbox"
              name="save_location"
              value="true"
              checked={current.save_location === 'true'}
              onChange={(event) => set({ ...current, save_location: event.target.checked ? 'true' : '' })}
              className="size-3.5 rounded border-input"
            />
            Save to My club, so it can be picked next time
          </label>
        )}
      </Field>
    </>
  )
}
