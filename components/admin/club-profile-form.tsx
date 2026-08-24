'use client'

import { useRef, useState } from 'react'
import { Building2, Trash2 } from 'lucide-react'
import { ToastActionForm } from '@/components/toast-action-form'
import { ClubLocationsField } from '@/components/admin/club-locations-field'
import { CurrencyField } from '@/components/admin/currency-field'
import { CopyLink } from '@/components/admin/copy-link'
import { saveClubProfileAction } from '@/app/admin-app/(protected)/my-club/actions'
import type { Club, ClubLocation } from '@/types/database'

type ClubProfileFormProps = {
  club: Pick<Club, 'name' | 'description' | 'logo_url' | 'city' | 'currency'>
  locations: Array<Pick<ClubLocation, 'id' | 'name' | 'address_line'>>
  /** Full address of the club page, ready to share. */
  clubUrl: string
}

/** Shared look for the fields: a filled surface instead of a border. */
const inputClass =
  'w-full rounded-2xl bg-zinc-100/80 px-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-foreground/20'

function TextField({
  name,
  label,
  hint,
  defaultValue,
  placeholder,
  required,
}: {
  name: string
  label: string
  hint?: string
  defaultValue?: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={`club-${name}`} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={`club-${name}`}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className={`h-11 ${inputClass}`}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function ClubProfileForm({ club, locations, clubUrl }: ClubProfileFormProps) {
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(club.logo_url)

  /**
   * The file input is set programmatically, so that "Remove" actually clears
   * what gets submitted — not just the image on screen.
   */
  function replaceLogo(file: File | null) {
    const input = logoInputRef.current
    if (!input) return

    const transfer = new DataTransfer()
    if (file) transfer.items.add(file)
    input.files = transfer.files
    setLogoPreview(file ? URL.createObjectURL(file) : null)
  }

  return (
    <ToastActionForm
      action={saveClubProfileAction}
      successMessage="Club profile saved."
      className="space-y-8"
    >
      <input
        ref={logoInputRef}
        type="file"
        name="logoFile"
        accept="image/*"
        className="hidden"
        onChange={(event) => replaceLogo(event.currentTarget.files?.[0] ?? null)}
      />
      {/* Empty value = the logo was removed. */}
      <input
        type="hidden"
        name="existingLogoUrl"
        value={logoPreview && logoPreview === club.logo_url ? club.logo_url ?? '' : ''}
      />

      {/* Logo */}
      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={() => logoInputRef.current?.click()}
          className="grid size-20 shrink-0 place-content-center overflow-hidden rounded-3xl bg-zinc-100 transition-colors hover:bg-zinc-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
        >
          {logoPreview ? (
            // Blob URL right after picking, so next/image buys us nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoPreview} alt="" className="size-full object-contain p-2" />
          ) : (
            <Building2 className="size-6 text-muted-foreground" aria-hidden />
          )}
          <span className="sr-only">Upload logo</span>
        </button>

        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">Logo</div>
          <p className="text-xs text-muted-foreground">
            A square mark or a simple logotype. The club page colour is taken from this.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="text-xs font-medium text-foreground underline-offset-4 hover:underline"
            >
              {logoPreview ? 'Replace logo' : 'Upload'}
            </button>
            {logoPreview && (
              <button
                type="button"
                onClick={() => replaceLogo(null)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <Trash2 className="size-3.5" aria-hidden />
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-6">
        <TextField
          name="name"
          label="Club name"
          defaultValue={club.name}
          placeholder="Latter Oslo"
          required
        />

        <TextField
          name="city"
          label="City"
          defaultValue={club.city ?? ''}
          placeholder="Oslo"
          hint="Used in filters and on the events."
        />

        <ClubLocationsField locations={locations} />

        <CurrencyField value={club.currency} />

        <div className="space-y-2">
          <label htmlFor="club-description" className="text-sm font-medium text-foreground">
            About the club
          </label>
          <textarea
            id="club-description"
            name="description"
            defaultValue={club.description ?? ''}
            rows={5}
            placeholder="A little about the vibe, the audience and what makes the club special."
            className={`resize-y py-3 ${inputClass}`}
          />
          <p className="text-xs text-muted-foreground">A few sentences. Shown at the top of the club page.</p>
        </div>
      </div>

      <div className="space-y-6 border-t pt-6">
        <CopyLink url={clubUrl} />

        <div className="flex items-center justify-end">
          <button
            type="submit"
            className="inline-flex h-11 items-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </ToastActionForm>
  )
}
