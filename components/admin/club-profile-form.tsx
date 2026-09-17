'use client'

import { useRef, useState } from 'react'
import { Building2, Trash2, Upload } from 'lucide-react'
import { ToastActionForm } from '@/components/toast-action-form'
import { ClubLocationsField } from '@/components/admin/club-locations-field'
import { CopyLink } from '@/components/admin/copy-link'
import { CurrencyField } from '@/components/admin/currency-field'
import {
  FIELD_GROUP_CLASS,
  FIELD_HINT_CLASS,
  FIELD_INPUT_CLASS,
  FIELD_TEXTAREA_CLASS,
  FieldFrame,
  FieldSection,
} from '@/components/admin/form-fields'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { saveClubProfileAction } from '@/app/admin-app/(protected)/my-club/actions'
import type { Club, ClubLocation } from '@/types/database'

type ClubProfileFormProps = {
  club: Pick<Club, 'name' | 'description' | 'logo_url' | 'city' | 'currency' | 'lineup_deadline_days'>
  /** Plattformens standard, som klubben følger når feltet står tomt. */
  defaultLineupDeadlineDays: number
  locations: Array<Pick<ClubLocation, 'id' | 'name' | 'address_line'>>
  /** Full address of the club page, ready to share. */
  clubUrl: string
}

/**
 * The club profile — what the audience sees on the club page.
 *
 * Samme feltform som Show details (`components/admin/form-fields`): én ramme
 * delt i grupper, og felt som er like høye enten de har en knapp, et symbol
 * eller ingenting i seg. Skjemaet lagres med knappen, ikke automatisk: logoen
 * lastes opp og fargen trekkes ut av den først når profilen lagres.
 */
export function ClubProfileForm({ club, locations, clubUrl, defaultLineupDeadlineDays }: ClubProfileFormProps) {
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
      className="space-y-5"
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

      <FieldFrame>
        <FieldSection id="club-profile-basics" title="Basics">
          <div className="col-span-12 flex items-center gap-4">
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="grid size-20 shrink-0 place-content-center overflow-hidden rounded-xl border border-input bg-muted/50 shadow-xs outline-none transition-[color,box-shadow] hover:bg-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {logoPreview ? (
                // Blob URL right after picking, so next/image buys us nothing here.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="" className="size-full object-contain p-2" />
              ) : (
                <Building2 className="size-6 text-muted-foreground" aria-hidden />
              )}
              <span className="sr-only">{logoPreview ? 'Replace logo' : 'Upload logo'}</span>
            </button>

            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium leading-snug">Logo</p>
              <p className="text-xs text-muted-foreground">
                A square mark or a simple logotype. The club page colour is taken from this.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => logoInputRef.current?.click()}>
                  <Upload data-icon="inline-start" />
                  {logoPreview ? 'Replace logo' : 'Upload'}
                </Button>
                {logoPreview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => replaceLogo(null)}
                    className="text-muted-foreground"
                  >
                    <Trash2 data-icon="inline-start" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Korte felt står to og to når rammen har bredde til det, ellers under hverandre. */}
          <Field className="col-span-12 min-w-0 gap-1.5 @xl:col-span-6">
            <FieldLabel htmlFor="club-name">Club name</FieldLabel>
            <div className={FIELD_GROUP_CLASS}>
              <Input
                id="club-name"
                name="name"
                defaultValue={club.name}
                placeholder="Latter Oslo"
                required
                className={FIELD_INPUT_CLASS}
              />
            </div>
          </Field>

          <CopyLink url={clubUrl} className="@xl:col-span-6" />
        </FieldSection>

        <FieldSection id="club-profile-location" title="Location">
          <Field className="col-span-12 min-w-0 gap-1.5 @xl:col-span-6">
            <FieldLabel htmlFor="club-city">City</FieldLabel>
            <div className={FIELD_GROUP_CLASS}>
              <Input
                id="club-city"
                name="city"
                defaultValue={club.city ?? ''}
                placeholder="Oslo"
                className={FIELD_INPUT_CLASS}
              />
            </div>
            <FieldDescription className={FIELD_HINT_CLASS}>Used in filters and on the events.</FieldDescription>
          </Field>

          <ClubLocationsField locations={locations} className="@xl:col-span-6" />
        </FieldSection>

        <FieldSection id="club-profile-tickets" title="Tickets">
          <CurrencyField value={club.currency} className="@xl:col-span-6" />
        </FieldSection>

        <FieldSection id="club-profile-booking" title="Booking">
          <Field className="col-span-12 min-w-0 gap-1.5 @xl:col-span-6">
            <FieldLabel htmlFor="club-lineup-deadline">Lineup deadline</FieldLabel>
            <div className={FIELD_GROUP_CLASS}>
              <Input
                id="club-lineup-deadline"
                name="lineup_deadline_days"
                type="number"
                min={1}
                max={120}
                step={1}
                defaultValue={club.lineup_deadline_days ?? ''}
                placeholder={String(defaultLineupDeadlineDays)}
                className={FIELD_INPUT_CLASS}
              />
              <span className="shrink-0 pr-3 text-sm text-muted-foreground">days before the show</span>
            </div>
            <FieldDescription className={FIELD_HINT_CLASS}>
              When the lineup should be settled, so the poster and the marketing have time. As the deadline
              gets close, booking sends every offer at once instead of waiting for the best comedians to
              reply. Leave it empty to follow the platform default of {defaultLineupDeadlineDays} days.
            </FieldDescription>
          </Field>
        </FieldSection>

        <FieldSection id="club-profile-about" title="About">
          <Field className="col-span-12 min-w-0 gap-1.5">
            <FieldLabel htmlFor="club-description">About the club</FieldLabel>
            <Textarea
              id="club-description"
              name="description"
              defaultValue={club.description ?? ''}
              rows={5}
              placeholder="A little about the vibe, the audience and what makes the club special."
              className={FIELD_TEXTAREA_CLASS}
            />
            <FieldDescription className={FIELD_HINT_CLASS}>
              A few sentences. Shown at the top of the club page.
            </FieldDescription>
          </Field>
        </FieldSection>
      </FieldFrame>

      <div className="flex justify-end mt-2">
        <Button type="submit" size="lg" className="px-6 text-lg">
          Save
        </Button>
      </div>
    </ToastActionForm>
  )
}
