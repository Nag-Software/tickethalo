'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, ImagePlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Field, FieldContent, FieldLabel } from '@/components/ui/field'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { saveClubProfileAction } from '@/app/admin-app/min-klubb/actions'
import type { Club } from '@/types/database'

type FormValues = {
  name: string
  city: string
  locationName: string
  addressLine: string
  description: string
}

type SaveSnapshot = FormValues & {
  logoPreview: string | null
  headerPreview: string | null
}

const AUTOSAVE_DELAY_MS = 1200

type ClubProfileFormProps = {
  club: Pick<Club, 'id' | 'name' | 'slug' | 'description' | 'logo_url' | 'header_image_url' | 'location_name' | 'address_line' | 'city'>
}

function ImageUpload({
  label,
  hint,
  preview,
  aspectClass,
  emptyLabel,
  active,
  onClick,
  onDrop,
  onDragOver,
  onDragLeave,
  onClear,
}: {
  label: string
  hint: string
  preview?: string | null
  aspectClass: string
  emptyLabel: string
  active: boolean
  onClick: () => void
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onClear?: () => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {preview && onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <Trash2 className="size-3.5" />
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
        className={`group relative overflow-hidden rounded-xl border border-dashed transition-colors ${aspectClass} ${active ? 'border-primary bg-primary/5' : 'border-border bg-muted/30 hover:border-foreground/25 hover:bg-muted/50'}`}
      >
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <ImagePlus className="size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{emptyLabel}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function SaveStatus({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  const label =
    status === 'saving' ? 'Lagrer…'
    : status === 'saved' ? 'Lagret'
    : status === 'error' ? 'Lagring feilet'
    : 'Lagres automatisk'

  return (
    <span className={`text-xs ${status === 'error' ? 'text-destructive' : 'text-muted-foreground'} ${status === 'saving' ? 'animate-pulse' : ''}`}>
      {label}
    </span>
  )
}

export function ClubProfileForm({ club }: ClubProfileFormProps) {
  const router = useRouter()
  const logoInputRef = useRef<HTMLInputElement>(null)
  const headerInputRef = useRef<HTMLInputElement>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef<SaveSnapshot>({
    name: club.name,
    city: club.city ?? '',
    locationName: club.location_name ?? '',
    addressLine: club.address_line ?? '',
    description: club.description ?? '',
    logoPreview: club.logo_url,
    headerPreview: club.header_image_url,
  })
  const savedLogoUrlRef = useRef(club.logo_url)
  const savedHeaderUrlRef = useRef(club.header_image_url)
  const logoPreviewRef = useRef(club.logo_url)
  const headerPreviewRef = useRef(club.header_image_url)

  const [values, setValues] = useState<FormValues>({
    name: club.name,
    city: club.city ?? '',
    locationName: club.location_name ?? '',
    addressLine: club.address_line ?? '',
    description: club.description ?? '',
  })
  const [logoPreview, setLogoPreview] = useState<string | null>(club.logo_url)
  const [headerPreview, setHeaderPreview] = useState<string | null>(club.header_image_url)
  logoPreviewRef.current = logoPreview
  headerPreviewRef.current = headerPreview
  const [logoActive, setLogoActive] = useState(false)
  const [headerActive, setHeaderActive] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

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

  function updateValue<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  function buildFormData(snapshot: SaveSnapshot) {
    const formData = new FormData()
    formData.set('name', snapshot.name)
    formData.set('city', snapshot.city)
    formData.set('locationName', snapshot.locationName)
    formData.set('addressLine', snapshot.addressLine)
    formData.set('description', snapshot.description)

    const logoFile = logoInputRef.current?.files?.[0]
    const headerFile = headerInputRef.current?.files?.[0]

    if (logoFile) {
      formData.set('logoFile', logoFile)
    }

    if (headerFile) {
      formData.set('headerFile', headerFile)
    }

    const existingLogoUrl =
      snapshot.logoPreview &&
      (snapshot.logoPreview === savedLogoUrlRef.current || snapshot.logoPreview === club.logo_url)
        ? savedLogoUrlRef.current ?? ''
        : ''
    const existingHeaderImageUrl =
      snapshot.headerPreview &&
      (snapshot.headerPreview === savedHeaderUrlRef.current || snapshot.headerPreview === club.header_image_url)
        ? savedHeaderUrlRef.current ?? ''
        : ''

    formData.set('existingLogoUrl', existingLogoUrl)
    formData.set('existingHeaderImageUrl', existingHeaderImageUrl)

    return formData
  }

  async function persist(snapshot: SaveSnapshot) {
    if (!snapshot.name.trim()) return

    setSaveStatus('saving')

    try {
      await saveClubProfileAction(buildFormData(snapshot))
      lastSavedRef.current = snapshot
      setSaveStatus('saved')
      router.refresh()

      if (savedStatusTimeoutRef.current) {
        clearTimeout(savedStatusTimeoutRef.current)
      }

      savedStatusTimeoutRef.current = setTimeout(() => {
        setSaveStatus('idle')
      }, 2000)
    } catch (error) {
      setSaveStatus('error')
      toast.error(error instanceof Error ? error.message : 'Kunne ikke lagre klubbprofilen.')
    }
  }

  function scheduleAutosave(snapshot: SaveSnapshot) {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null

      const lastSaved = lastSavedRef.current
      const hasChanges =
        snapshot.name !== lastSaved.name ||
        snapshot.city !== lastSaved.city ||
        snapshot.locationName !== lastSaved.locationName ||
        snapshot.addressLine !== lastSaved.addressLine ||
        snapshot.description !== lastSaved.description ||
        snapshot.logoPreview !== lastSaved.logoPreview ||
        snapshot.headerPreview !== lastSaved.headerPreview

      if (!hasChanges) return

      void persist(snapshot)
    }, AUTOSAVE_DELAY_MS)
  }

  useEffect(() => {
    savedLogoUrlRef.current = club.logo_url
    savedHeaderUrlRef.current = club.header_image_url

    if (club.logo_url && logoPreviewRef.current?.startsWith('blob:')) {
      if (logoInputRef.current) {
        logoInputRef.current.files = new DataTransfer().files
      }
      setLogoPreview(club.logo_url)
      lastSavedRef.current = { ...lastSavedRef.current, logoPreview: club.logo_url }
    }

    if (club.header_image_url && headerPreviewRef.current?.startsWith('blob:')) {
      if (headerInputRef.current) {
        headerInputRef.current.files = new DataTransfer().files
      }
      setHeaderPreview(club.header_image_url)
      lastSavedRef.current = { ...lastSavedRef.current, headerPreview: club.header_image_url }
    }
  }, [club.logo_url, club.header_image_url])

  useEffect(() => {
    const snapshot: SaveSnapshot = {
      ...values,
      logoPreview,
      headerPreview,
    }

    scheduleAutosave(snapshot)

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [values, logoPreview, headerPreview])

  useEffect(() => {
    return () => {
      if (savedStatusTimeoutRef.current) {
        clearTimeout(savedStatusTimeoutRef.current)
      }
    }
  }, [])

  return (
    <div className="space-y-6">
      <input ref={logoInputRef} type="file" name="logoFile" accept="image/*" className="hidden" onChange={(event) => replaceSingleFile(logoInputRef.current, event.currentTarget.files?.[0] ?? null, setLogoPreview)} />
      <input ref={headerInputRef} type="file" name="headerFile" accept="image/*" className="hidden" onChange={(event) => replaceSingleFile(headerInputRef.current, event.currentTarget.files?.[0] ?? null, setHeaderPreview)} />

      <Card>
        <CardHeader>
          <CardTitle>Grunnleggende info</CardTitle>
          <CardDescription>Navn, beskrivelse og adresse vises på klubbens profil.</CardDescription>
          <CardAction>
            <SaveStatus status={saveStatus} />
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel htmlFor="club-name">Klubbnavn</FieldLabel>
            <FieldContent>
              <Input id="club-name" name="name" value={values.name} onChange={(event) => updateValue('name', event.target.value)} placeholder="Latter Oslo" required />
            </FieldContent>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="club-city">By</FieldLabel>
              <FieldContent>
                <Input id="club-city" name="city" value={values.city} onChange={(event) => updateValue('city', event.target.value)} placeholder="Oslo" />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="club-location">Lokasjon</FieldLabel>
              <FieldContent>
                <Input id="club-location" name="locationName" value={values.locationName} onChange={(event) => updateValue('locationName', event.target.value)} placeholder="Sentrum Scene" />
              </FieldContent>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="club-address">Adresse</FieldLabel>
            <FieldContent>
              <Input id="club-address" name="addressLine" value={values.addressLine} onChange={(event) => updateValue('addressLine', event.target.value)} placeholder="Arbeidersamfunnets plass 1" />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="club-description">Om klubben</FieldLabel>
            <FieldContent>
              <textarea
                id="club-description"
                name="description"
                value={values.description}
                onChange={(event) => updateValue('description', event.target.value)}
                placeholder="Kort beskrivelse av klubben og stemningen."
                rows={4}
                className="min-h-24 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </FieldContent>
          </Field>

          <p className="text-xs text-muted-foreground">URL: /{club.slug}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logo og header</CardTitle>
          <CardDescription>Bildene brukes i admin, på events og på klubbens offentlige side.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-[140px_1fr]">
            <ImageUpload
              label="Logo"
              hint="Kvadratisk, min. 200×200 px"
              preview={logoPreview}
              aspectClass="aspect-square"
              emptyLabel="Last opp logo"
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

            <ImageUpload
              label="Headerbilde"
              hint="Bredt bilde, anbefalt 16:9"
              preview={headerPreview}
              aspectClass="aspect-[16/9]"
              emptyLabel="Last opp headerbilde"
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Forhåndsvisning</CardTitle>
          <CardDescription>Slik ser profilen ut med dagens innhold.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
            <div className="relative aspect-[2/1] bg-muted">
              {headerPreview ? <img src={headerPreview} alt="" className="h-full w-full object-cover" /> : null}
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
              <div className="absolute inset-x-4 bottom-4 flex items-end gap-3 text-white">
                <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/15 ring-1 ring-white/20">
                  {logoPreview ? <img src={logoPreview} alt="" className="h-full w-full object-cover" /> : <Building2 className="size-5" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{values.name || 'Klubbnavn'}</p>
                  <p className="truncate text-xs text-white/75">
                    {[values.city, values.locationName].filter(Boolean).join(' · ') || 'By og lokasjon'}
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-2 p-4">
              <p className="text-sm text-muted-foreground">
                {values.description || 'Beskrivelse vises her.'}
              </p>
              {values.addressLine ? (
                <p className="text-xs text-muted-foreground">{values.addressLine}</p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
