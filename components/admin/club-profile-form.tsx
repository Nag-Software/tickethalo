'use client'

import { useRef, useState } from 'react'
import { Building2, MapPin, Sparkles, Trash2, UploadCloud } from 'lucide-react'
import { ToastActionForm } from '@/components/toast-action-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field'
import { saveClubProfileAction } from '@/app/admin-app/(protected)/min-klubb/actions'
import type { Club } from '@/types/database'

type ClubProfileFormProps = {
  club: Pick<Club, 'id' | 'name' | 'slug' | 'description' | 'logo_url' | 'header_image_url' | 'location_name' | 'address_line' | 'city'>
}

function Dropzone({
  title,
  description,
  preview,
  emptyLabel,
  active,
  onClick,
  onDrop,
  onDragOver,
  onDragLeave,
  onClear,
}: {
  title: string
  description: string
  preview?: string | null
  emptyLabel: string
  active: boolean
  onClick: () => void
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onClear?: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        {preview && onClear ? (
          <button type="button" onClick={onClear} className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground">
            <Trash2 className="h-3.5 w-3.5" />
            Fjern
          </button>
        ) : null}
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClick()
          }
        }}
        className={`group relative overflow-hidden rounded-[1.75rem] border border-dashed p-4 transition ${active ? 'border-black bg-black/5 shadow-[0_0_0_4px_rgba(24,24,27,0.06)]' : 'border-zinc-300 bg-white hover:border-zinc-400 hover:bg-zinc-50'}`}
      >
        {preview ? (
          <div className="relative aspect-[16/10] overflow-hidden rounded-[1.25rem] border border-black/10 bg-zinc-100">
            <img src={preview} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-x-3 bottom-3 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur">
              Slipp nytt bilde her for å erstatte
            </div>
          </div>
        ) : (
          <div className="flex aspect-[16/10] flex-col items-center justify-center rounded-[1.25rem] bg-[radial-gradient(circle_at_top,_rgba(0,0,0,0.06),_transparent_45%),linear-gradient(135deg,_#fff,_#faf8f2)] px-6 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-black text-white shadow-sm">
              <UploadCloud className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-foreground">{emptyLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">Dra et bilde hit eller trykk for å velge fil</p>
          </div>
        )}
      </div>
    </div>
  )
}

export function ClubProfileForm({ club }: ClubProfileFormProps) {
  const logoInputRef = useRef<HTMLInputElement>(null)
  const headerInputRef = useRef<HTMLInputElement>(null)

  const [logoPreview, setLogoPreview] = useState<string | null>(club.logo_url)
  const [headerPreview, setHeaderPreview] = useState<string | null>(club.header_image_url)
  const [logoActive, setLogoActive] = useState(false)
  const [headerActive, setHeaderActive] = useState(false)

  function replaceSingleFile(input: HTMLInputElement | null, file: File | null, setPreview: (value: string | null) => void) {
    if (!input) return

    const transfer = new DataTransfer()
    if (file) {
      transfer.items.add(file)
      setPreview(URL.createObjectURL(file))
    } else {
      setPreview(null)
    }

    input.files = transfer.files
  }

  return (
    <ToastActionForm action={saveClubProfileAction} successMessage="Klubbprofilen ble oppdatert." className="space-y-6">
      <input ref={logoInputRef} type="file" name="logoFile" accept="image/*" className="hidden" onChange={(event) => replaceSingleFile(logoInputRef.current, event.currentTarget.files?.[0] ?? null, setLogoPreview)} />
      <input ref={headerInputRef} type="file" name="headerFile" accept="image/*" className="hidden" onChange={(event) => replaceSingleFile(headerInputRef.current, event.currentTarget.files?.[0] ?? null, setHeaderPreview)} />

      <input type="hidden" name="existingLogoUrl" value={logoPreview && logoPreview === club.logo_url ? club.logo_url ?? '' : ''} />
      <input type="hidden" name="existingHeaderImageUrl" value={headerPreview && headerPreview === club.header_image_url ? club.header_image_url ?? '' : ''} />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px]">
        <div className="space-y-6">
          <div className="rounded-[2rem] border bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-amber-700">
                  <Sparkles className="h-3.5 w-3.5" />
                  Identitet
                </div>
                <h3 className="mt-3 text-xl font-semibold tracking-tight">Gi klubben et tydelig uttrykk</h3>
                <p className="mt-1 text-sm text-muted-foreground">Oppdater navn, fortelling og lokasjon slik at klubbprofilen føles ferdig.</p>
              </div>
              <div className="rounded-2xl border bg-zinc-50 px-3 py-2 text-right text-xs text-muted-foreground">
                <div className="font-medium text-foreground">/{club.slug}</div>
                <div>Intern klubbslug</div>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="club-name">
                  <FieldTitle>Klubbnavn</FieldTitle>
                </FieldLabel>
                <FieldContent>
                  <Input id="club-name" name="name" defaultValue={club.name} placeholder="Latter Oslo" required />
                  <FieldDescription>Vises i admin-app, på events og i klubbvalg.</FieldDescription>
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel htmlFor="club-city">
                  <FieldTitle>By</FieldTitle>
                </FieldLabel>
                <FieldContent>
                  <Input id="club-city" name="city" defaultValue={club.city ?? ''} placeholder="Oslo" />
                  <FieldDescription>Brukes i filtre, etiketter og oversikter.</FieldDescription>
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel htmlFor="club-location">
                  <FieldTitle>Lokasjon</FieldTitle>
                </FieldLabel>
                <FieldContent>
                  <Input id="club-location" name="locationName" defaultValue={club.location_name ?? ''} placeholder="Sentrum Scene" />
                  <FieldDescription>Navnet på klubbens faste venue eller rom.</FieldDescription>
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel htmlFor="club-address">
                  <FieldTitle>Adresse</FieldTitle>
                </FieldLabel>
                <FieldContent>
                  <Input id="club-address" name="addressLine" defaultValue={club.address_line ?? ''} placeholder="Arbeidersamfunnets plass 1" />
                  <FieldDescription>Full adresse for publikum og artister.</FieldDescription>
                </FieldContent>
              </Field>
            </div>

            <div className="mt-5 rounded-[1.5rem] border bg-zinc-50/80 p-4">
              <label htmlFor="club-description" className="mb-2 block text-sm font-medium text-foreground">Om klubben</label>
              <textarea
                id="club-description"
                name="description"
                defaultValue={club.description ?? ''}
                placeholder="Fortell kort om stemningen, publikumet og hva som gjør klubben spesiell."
                rows={7}
                className="min-h-40 w-full resize-y rounded-[1.5rem] border border-input bg-white px-4 py-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <p className="mt-2 text-xs text-muted-foreground">Kort, tydelig og visuelt. Denne teksten bør føles som klubbens egen intro.</p>
            </div>
          </div>

        </div>

        <div className="space-y-6">
          <div className="rounded-[2rem] border bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black text-white">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-xl font-semibold tracking-tight">Brand assets</h3>
                <p className="text-sm text-muted-foreground">Logo og header brukes som klubbens signaturflater.</p>
              </div>
            </div>

            <div className="space-y-5">
              <Dropzone
                title="Logo"
                description="Best som kvadratisk merke eller enkel logotype."
                preview={logoPreview}
                emptyLabel="Slipp inn klubbens logo"
                active={logoActive}
                onClick={() => logoInputRef.current?.click()}
                onDrop={(event) => {
                  event.preventDefault()
                  setLogoActive(false)
                  replaceSingleFile(logoInputRef.current, Array.from(event.dataTransfer.files).find((file) => file.type.startsWith('image/')) ?? null, setLogoPreview)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  setLogoActive(true)
                }}
                onDragLeave={() => setLogoActive(false)}
                onClear={() => replaceSingleFile(logoInputRef.current, null, setLogoPreview)}
              />

              <Dropzone
                title="Headerbilde"
                description="Et bredt bilde som setter stemning øverst på klubbkortet og siden."
                preview={headerPreview}
                emptyLabel="Slipp inn et hero-bilde"
                active={headerActive}
                onClick={() => headerInputRef.current?.click()}
                onDrop={(event) => {
                  event.preventDefault()
                  setHeaderActive(false)
                  replaceSingleFile(headerInputRef.current, Array.from(event.dataTransfer.files).find((file) => file.type.startsWith('image/')) ?? null, setHeaderPreview)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  setHeaderActive(true)
                }}
                onDragLeave={() => setHeaderActive(false)}
                onClear={() => replaceSingleFile(headerInputRef.current, null, setHeaderPreview)}
              />
            </div>
          </div>

          <div className="rounded-[2rem] border bg-[radial-gradient(circle_at_top_left,_rgba(255,224,178,0.5),_transparent_24%),linear-gradient(135deg,_#fff,_#faf8f2)] p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-foreground shadow-sm">
                <MapPin className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-xl font-semibold tracking-tight">Preview</h3>
                <p className="text-sm text-muted-foreground">Slik ser klubbens profil ut med dagens innhold.</p>
              </div>
            </div>

            <div className="overflow-hidden rounded-[1.75rem] border bg-white shadow-sm">
              <div className="relative aspect-[16/9] bg-zinc-100">
                {headerPreview ? <img src={headerPreview} alt="" className="h-full w-full object-cover" /> : null}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/15 to-transparent" />
                <div className="absolute inset-x-4 bottom-4 flex items-end gap-3 text-white">
                  <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-white/15 backdrop-blur">
                    {logoPreview ? <img src={logoPreview} alt="" className="h-full w-full object-cover" /> : <Building2 className="h-6 w-6" />}
                  </div>
                  <div>
                    <div className="text-lg font-semibold leading-tight">{club.name}</div>
                    <div className="text-xs text-white/75">{club.city || 'By mangler'} • {club.location_name || 'Lokasjon mangler'}</div>
                  </div>
                </div>
              </div>

              <div className="space-y-3 p-4">
                <div className="rounded-2xl bg-zinc-50 p-3 text-sm text-muted-foreground">
                  {club.description || 'Om klubben-teksten kommer til å vises her når du lagrer.'}
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border bg-white px-3 py-1.5">{club.address_line || 'Adresse mangler'}</span>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <Button type="submit" size="lg">
                Lagre klubbprofil
              </Button>
            </div>
          </div>
        </div>
      </section>
    </ToastActionForm>
  )
}