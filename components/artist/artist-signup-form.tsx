"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  AtSign,
  BadgeCheck,
  Camera,
  Globe2,
  ImagePlus,
  Lock,
  Phone,
  Star,
  Trash2,
  User,
  Video,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ARTIST_ROLE_LABEL_OPTIONS } from '@/lib/artist-roles'
import { MAX_ARTIST_PROFILE_IMAGES } from '@/lib/artist-profile-images'
import {
  buildSignupFieldCompletion,
  getSignupProgress,
  type SignupFieldId,
} from '@/lib/artist-signup'
import type { ArtistSignupDraft } from '@/lib/artist-registration-draft'
import { Label } from "../ui/label"

const categories = ARTIST_ROLE_LABEL_OPTIONS

type ProfileImageEntry = {
  id: string
  file: File
  preview: string
}

const fieldClassName = 'h-11'
const selectClassName = 'h-11 w-full rounded-2xl border border-input bg-input/30 px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'
const textareaClassName = 'min-h-28 w-full rounded-2xl border border-input bg-input/30 px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

export function ArtistSignupForm({
  className,
  action = "/artist-app/signup/submit",
  draft,
  errorMessage,
  successMessage,
  ...props
}: React.ComponentProps<"div"> & {
  action?: string
  draft?: ArtistSignupDraft
  errorMessage?: string
  successMessage?: string
}) {
  const completionMode = draft?.mode === 'complete'
  const [values, setValues] = useState<Record<SignupFieldId, boolean>>(() =>
    buildSignupFieldCompletion(draft, completionMode),
  )
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    draft?.category?.length ? draft.category : ['Stand-up'],
  )
  const [profileImages, setProfileImages] = useState<ProfileImageEntry[]>([])
  const [primaryImageIndex, setPrimaryImageIndex] = useState(0)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const profileFilesInputRef = useRef<HTMLInputElement>(null)
  const profileImagesRef = useRef(profileImages)
  profileImagesRef.current = profileImages

  const hasProfileImages = profileImages.length > 0 || Boolean(draft?.hasProfileImage)

  useEffect(() => {
    setValues((prev) => ({ ...prev, profile_images: hasProfileImages }))
  }, [hasProfileImages])

  useEffect(() => {
    return () => {
      profileImagesRef.current.forEach((image) => URL.revokeObjectURL(image.preview))
    }
  }, [])

  useEffect(() => {
    if (errorMessage) toast.error(errorMessage)
    if (successMessage) toast.success(successMessage)
  }, [errorMessage, successMessage])

  const signupProgress = useMemo(() => getSignupProgress(values, completionMode), [values, completionMode])
  const { completed, total: requiredTotal, progress, missing } = signupProgress
  const passwordsMismatch = !completionMode && confirmPassword.length > 0 && password !== confirmPassword

  function updateTextField(field: SignupFieldId, value: string) {
    setValues((prev) => ({
      ...prev,
      [field]: field === "password" ? value.length >= 8 : value.trim().length > 0,
    }))
  }

  function addProfileImages(files: FileList | File[] | null) {
    if (!files?.length) return

    const nextFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (nextFiles.length === 0) {
      toast.error('Velg PNG, JPG eller WebP.')
      return
    }

    setProfileImages((prev) => {
      const remaining = MAX_ARTIST_PROFILE_IMAGES - prev.length
      if (remaining <= 0) {
        toast.error(`Du kan laste opp maks ${MAX_ARTIST_PROFILE_IMAGES} profilbilder.`)
        return prev
      }

      const accepted = nextFiles.slice(0, remaining)
      if (accepted.length < nextFiles.length) {
        toast.error(`Du kan laste opp maks ${MAX_ARTIST_PROFILE_IMAGES} profilbilder.`)
      }

      return [
        ...prev,
        ...accepted.map((file) => ({
          id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
          file,
          preview: URL.createObjectURL(file),
        })),
      ]
    })
  }

  function removeProfileImage(index: number) {
    setProfileImages((prev) => {
      const next = [...prev]
      const [removed] = next.splice(index, 1)
      if (removed) URL.revokeObjectURL(removed.preview)

      setPrimaryImageIndex((currentPrimary) => {
        if (next.length === 0) return 0
        if (index < currentPrimary) return currentPrimary - 1
        if (index === currentPrimary) return Math.min(currentPrimary, next.length - 1)
        return Math.min(currentPrimary, next.length - 1)
      })

      return next
    })
  }

  function syncProfileFilesInput() {
    const input = profileFilesInputRef.current
    if (!input) return

    const transfer = new DataTransfer()
    profileImages.forEach((image) => transfer.items.add(image.file))
    input.files = transfer.files
  }

  function toggleCategory(category: string) {
    setSelectedCategories((prev) => {
      const next = prev.includes(category)
        ? prev.filter((item) => item !== category)
        : [...prev, category]
      return next.length > 0 ? next : prev
    })
  }

  return (
    <div className={cn('mx-auto max-w-6xl overflow-hidden rounded-2xl bg-card ring-1 ring-vipps-orange/10 shadow-lg', className)} {...props}>
      <div className="grid lg:grid-cols-[260px_1fr]">
        <aside className="bg-vipps-ink p-6 text-white lg:border-r lg:border-white/10">
          <div className="lg:sticky lg:top-6">
            <h1 className="mt-6 text-3xl font-semibold leading-tight tracking-tight text-white">
              {completionMode ? 'Fullfør profil' : 'Opprett profil'}
            </h1>
            <p className="mt-3 text-sm leading-6 text-white/90">
              {completionMode
                ? 'Kontoen din finnes allerede. Fyll ut resten av profilen for å bli vurdert til bookinger.'
                : 'Profilen sendes til booking-teamet for vurdering.'}
            </p>

            <div className="mt-6 hidden rounded-xl border border-white/15 bg-white/10 p-4 lg:block">
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold uppercase tracking-wide text-white/80">Registrering</span>
                <span className="font-bold text-white">{completed}/{requiredTotal}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-vipps-orange transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-3 text-xs leading-5 text-white/90">
                {missing.length === 0
                  ? 'Alt obligatorisk er fylt ut.'
                  : `Mangler: ${missing.map((field) => field.label).join(', ')}`}
              </p>
            </div>
          </div>
        </aside>

        <form
          action={action}
          method="post"
          encType="multipart/form-data"
          className="space-y-8 p-6 md:p-8"
          onSubmit={(event) => {
            if (!hasProfileImages) {
              event.preventDefault()
              toast.error('Last opp minst ett profilbilde for å registrere profilen.')
              return
            }
            if (!completionMode && password !== confirmPassword) {
              event.preventDefault()
              toast.error('Passordene må være like.')
              return
            }
            syncProfileFilesInput()
          }}
        >
          <input
            ref={profileFilesInputRef}
            type="file"
            name="profile_image_files"
            multiple
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
          />
          <input type="hidden" name="primary_profile_image_index" value={primaryImageIndex} />
          {selectedCategories.map((category) => (
            <input key={category} type="hidden" name="category" value={category} />
          ))}
          {completionMode && draft?.hasProfileImage && (
            <input type="hidden" name="existing_profile_image" value="1" />
          )}
          {completionMode && (
            <div className="rounded-2xl border border-border bg-vipps-orange-0 px-4 py-3 text-sm text-foreground/80">
              Du er innlogget som {draft?.email}. Eksisterende info er fylt inn — fullfør feltene som mangler.
            </div>
          )}
          {successMessage && (
            <div className="rounded-2xl border border-border bg-white px-3 py-2 text-sm text-foreground">
              {successMessage}
            </div>
          )}
          {errorMessage && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </div>
          )}

          <section className="space-y-4">
            <SectionHeader icon={User} title="Identitet" />
            <div className="grid gap-4 md:grid-cols-2">
              <LabeledInput icon={User} id="full_name" name="full_name" label="Fullt navn" autoComplete="name" defaultValue={draft?.full_name} onValue={(value) => updateTextField("full_name", value)} required />
              <LabeledInput icon={AtSign} id="email" name="email" label="E-post" type="email" placeholder="navn@eksempel.no" autoComplete="email" defaultValue={draft?.email} readOnly={completionMode} onValue={(value) => updateTextField("email", value)} required />
              <LabeledInput
                icon={Lock}
                id="password"
                name="password"
                label={completionMode ? 'Nytt passord (valgfritt)' : 'Passord'}
                type="password"
                minLength={completionMode ? undefined : 8}
                autoComplete={completionMode ? 'current-password' : 'new-password'}
                onValue={(value) => {
                  if (completionMode) {
                    setValues((prev) => ({ ...prev, password: true }))
                    return
                  }
                  setPassword(value)
                  updateTextField('password', value)
                }}
                required={!completionMode}
              />
              {!completionMode && (
                <div className="space-y-2">
                  <LabeledInput
                    icon={Lock}
                    id="confirm_password"
                    label="Bekreft passord"
                    type="password"
                    minLength={8}
                    autoComplete="new-password"
                    aria-invalid={passwordsMismatch}
                    onValue={(value) => setConfirmPassword(value)}
                    required
                  />
                  {passwordsMismatch && (
                    <p className="text-xs font-medium text-destructive">Passordene må være like.</p>
                  )}
                </div>
              )}
              <LabeledInput icon={Phone} id="phone" name="phone" label="Telefon" type="tel" autoComplete="tel" defaultValue={draft?.phone} onValue={(value) => updateTextField("phone", value)} required />
              <div className="space-y-2">
                <label htmlFor="language" className="text-sm font-medium">Språk</label>
                <select
                  id="language"
                  name="language"
                  required
                  defaultValue={draft?.language ?? ''}
                  onChange={(event) => updateTextField("language", event.target.value)}
                  className={selectClassName}
                >
                  <option value="" disabled>Velg språk</option>
                  <option>Norsk</option>
                  <option>Engelsk</option>
                  <option>Norsk og engelsk</option>
                </select>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeader icon={Camera} title="Profil" />
            <div className="space-y-3">
              {profileImages.length > 0 ? (
                <>
                  <p className="text-sm font-medium text-foreground/80">
                    {profileImages.length} bilde{profileImages.length === 1 ? '' : 'r'} valgt
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {profileImages.map((image, index) => {
                      const isPrimary = index === primaryImageIndex
                      return (
                        <div
                          key={image.id}
                          className={cn(
                            'relative overflow-hidden rounded-2xl bg-[#f5f3ff]',
                            isPrimary ? 'ring-2 ring-vipps-orange' : 'ring-1 ring-black/10',
                          )}
                        >
                          <img src={image.preview} alt="" className="aspect-[4/5] w-full object-cover" />
                          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
                            {isPrimary ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-vipps-orange px-2.5 py-0.5 text-[11px] font-semibold text-white">
                                <Star className="size-3 fill-current" />
                                Hovedbilde
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setPrimaryImageIndex(index)}
                                className="inline-flex items-center gap-1 rounded-full border border-border bg-white/90 px-2.5 py-0.5 text-[11px] font-semibold text-foreground transition hover:bg-white"
                              >
                                Sett som hovedbilde
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => removeProfileImage(index)}
                              className="inline-flex size-8 items-center justify-center rounded-full border border-border bg-white/90 text-foreground transition hover:bg-white"
                              aria-label="Fjern bilde"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <p className="text-sm font-medium text-foreground/80">
                  {draft?.hasProfileImage ? 'Eksisterende profilbilder lagret' : 'Last opp minst ett bilde'}
                </p>
              )}

              {profileImages.length < MAX_ARTIST_PROFILE_IMAGES && (
                <label
                  className={cn(
                    'cursor-pointer transition-colors',
                    profileImages.length === 0
                      ? 'flex items-center gap-4 rounded-2xl border-2 border-dashed border-border bg-vipps-orange-0 p-4 hover:bg-vipps-orange-10/60'
                      : 'inline-flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm font-semibold hover:bg-muted',
                  )}
                >
                  {profileImages.length === 0 ? (
                    <>
                      <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-white text-vipps-orange">
                        <ImagePlus className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Profilbilder</p>
                        <p className="text-sm font-medium text-foreground/80">maks {MAX_ARTIST_PROFILE_IMAGES} bilder</p>
                      </div>
                      <span className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Velg bilder</span>
                    </>
                  ) : (
                    <>
                      <ImagePlus className="size-4" />
                      Legg til flere bilder
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="sr-only"
                    onChange={(event) => {
                      addProfileImages(event.target.files)
                      event.target.value = ''
                    }}
                  />
                </label>
              )}

              <Label className="text-xs text-muted-foreground">
                Velg minst ett bilde og marker hvilket som er hovedbilde. Hovedbildet brukes på plakat ved booking.
              </Label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="gender" className="text-sm font-medium">Kjønn</label>
                <select
                  id="gender"
                  name="gender"
                  required
                  defaultValue={draft?.gender ?? ''}
                  onChange={(event) => updateTextField("gender", event.target.value)}
                  className={selectClassName}
                >
                  <option value="" disabled>Velg kjønn</option>
                  <option value="male">Mann</option>
                  <option value="female">Kvinne</option>
                  <option value="other">Annet</option>
                </select>
              </div>
              <div className="space-y-2">
                <LabeledInput icon={Video} id="youtube" name="youtube" label="YouTube-video (valgfritt)" type="url" placeholder="https://youtube.com/watch?v=..." defaultValue={draft?.youtube} onValue={() => {}} />
                <Label className="text-xs text-muted-foreground">
                    Anbefales! Vi benytter denne videoen til å vurdere ditt sceneutrykk, og den vil ikke bli publisert utenfor vårt interne system.
                </Label>
              </div>
            </div>

            <div className="space-y-2 hidden">
              <p className="text-sm font-medium">Kategori</p>
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => {
                  const checked = selectedCategories.includes(category)
                  return (
                    <label
                      key={category}
                      className={cn(
                        'cursor-pointer rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors',
                        checked ? 'border-transparent bg-primary text-primary-foreground' : 'border-border bg-white text-foreground hover:bg-muted'
                      )}
                    >
                      <input
                        type="checkbox"
                        name="category"
                        value={category}
                        checked={checked}
                        onChange={() => toggleCategory(category)}
                        className="sr-only"
                      />
                      {category}
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="bio" className="text-sm font-medium">Kort bio</label>
              <textarea
                id="bio"
                name="bio"
                rows={4}
                defaultValue={draft?.bio}
                className={textareaClassName}
                placeholder="Fortell kort om sceneerfaring, stil og type show."
              />
            </div>
          </section>

          <section className="space-y-4 border-t border-border pt-6">
            <SectionHeader icon={Globe2} title="SoMe-lenker" aside="valgfritt" />
            <div className="grid gap-4 md:grid-cols-2">
              <Input id="instagram" name="instagram" type="url" placeholder="Instagram URL" defaultValue={draft?.instagram} className={fieldClassName} />
              <Input id="tiktok" name="tiktok" type="url" placeholder="TikTok URL" defaultValue={draft?.tiktok} className={fieldClassName} />
              <Input id="facebook" name="facebook" type="url" placeholder="Facebook URL" defaultValue={draft?.facebook} className={fieldClassName} />
              <Input id="website" name="website" type="url" placeholder="Nettside URL" defaultValue={draft?.website} className={fieldClassName} />
            </div>
          </section>

          <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-normal text-muted-foreground max-w-md gap-3 flex flex-col">
              <p>
              Jo mer utfyllende info, dess lettere er det for nye bookere som ikke kjenner deg godt å gjøre en vurdering. 
              </p>
              <p className="text-sm font-medium text-muted-foreground">
                {missing.length === 0
                  ? 'Alt klart.'
                  : `${missing.length} obligatorisk${missing.length === 1 ? '' : 'e'} felt mangler: ${missing.map((field) => field.label.toLowerCase()).join(', ')}.`}
              </p>
            </div>
            <Button
              type="submit"
              size="lg"
              className="h-11 px-6 sm:min-w-48"
              disabled={missing.length > 0 || (!completionMode && password !== confirmPassword)}
            >
              <BadgeCheck className="size-4" />
              {completionMode ? 'Fullfør artistprofil' : 'Registrer artistprofil'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  aside,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  aside?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-vipps-orange text-white">
          <Icon className="size-4" />
        </div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-vipps-orange-80">{title}</h2>
      </div>
      {aside && <span className="text-xs font-medium text-muted-foreground">{aside}</span>}
    </div>
  )
}

function LabeledInput({
  icon: Icon,
  label,
  onValue,
  defaultValue,
  readOnly,
  ...props
}: React.ComponentProps<typeof Input> & {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onValue: (value: string) => void
  defaultValue?: string
  readOnly?: boolean
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={props.id} className="text-sm font-medium text-foreground">{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          {...props}
          defaultValue={defaultValue}
          readOnly={readOnly}
          className={cn(fieldClassName, 'pl-9', readOnly && 'bg-muted text-muted-foreground', props.className)}
          onChange={(event) => onValue(event.target.value)}
        />
      </div>
    </div>
  )
}