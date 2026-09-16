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
  User,
  Video,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MAX_UPLOAD_BYTES, compressImageFile } from "@/lib/image-compress"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LocationField, type SelectedLocation } from "@/components/artist/location-field"
import { LanguageField } from "@/components/artist/language-field"
import { defaultLanguagesForCountry, lookupCountry } from "@/lib/geo"
import type { LanguageCode } from "@/lib/languages"
import { Label } from "../ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const requiredFields = [
  { id: "full_name", label: "Name" },
  { id: "email", label: "Email" },
  { id: "password", label: "Password" },
  { id: "password_confirm", label: "Confirm Password" },
  { id: "profile_image_file", label: "Profile Picture" },
  { id: "phone", label: "Phone" },
  { id: "location", label: "Location" },
  { id: "language", label: "Language" },
  { id: "gender", label: "Gender" },
] as const

type RequiredFieldId = (typeof requiredFields)[number]["id"]

const focusRing = 'outline-none ring-1 ring-inset ring-[var(--ev-line)] transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-[var(--ev-accent-fill)]'
const fieldClassName = `h-11 rounded-xl border-0 bg-[var(--ev-bg)] text-[14px] shadow-none ${focusRing}`
const selectClassName = `h-11 w-full appearance-none rounded-xl border-0 bg-[var(--ev-bg)] px-3.5 text-[14px] data-placeholder:text-[var(--ev-text)] ${focusRing}`

const textareaClassName = `min-h-28 w-full rounded-xl bg-[var(--ev-bg)] px-3.5 py-3 text-[14px] leading-relaxed placeholder:text-[var(--ev-faint)] ${focusRing}`

/** Samme verdier som `ArtistGender` — se migrasjon 042. */
const GENDER_OPTIONS = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const

export function ArtistSignupForm({
  className,
  action = "/artist-app/signup/submit",
  errorMessage,
  successMessage,
  ...props
}: React.ComponentProps<"div"> & {
  action?: string
  errorMessage?: string
  successMessage?: string
}) {
  const [values, setValues] = useState<Record<RequiredFieldId, boolean>>({
    full_name: false,
    email: false,
    password: false,
    password_confirm: false,
    profile_image_file: false,
    phone: false,
    location: false,
    language: false,
    gender: false,
  })
  const [imageName, setImageName] = useState<string | null>(null)
  const [preparingImage, setPreparingImage] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [location, setLocation] = useState<SelectedLocation | null>(null)
  const [languages, setLanguages] = useState<LanguageCode[]>([])
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  // Beholdes så hintet under språkvelgeren kan si hvor forslaget kom fra.
  const [suggestedFrom, setSuggestedFrom] = useState<string | null>(null)

  const setLanguageSelection = (next: LanguageCode[]) => {
    setLanguages(next)
    setValues((current) => ({ ...current, language: next.length > 0 }))
  }

  /**
   * Å velge by fyller inn språket landet snakker — men bare når komikeren ikke
   * alt har valgt selv, ellers ville et bytte av by overskrive et bevisst valg.
   */
  const selectLocation = (next: SelectedLocation) => {
    setLocation(next)
    setValues((current) => ({ ...current, location: true }))

    if (languages.length > 0) return
    const suggestion = defaultLanguagesForCountry(next.country)
    if (suggestion.length === 0) return
    setLanguageSelection(suggestion)
    setSuggestedFrom(lookupCountry(next.country)?.name ?? next.country)
  }

  useEffect(() => {
    if (errorMessage) toast.error(errorMessage)
    if (successMessage) toast.success(successMessage)
  }, [errorMessage, successMessage])

  const completed = useMemo(
    () => requiredFields.filter((field) => values[field.id]).length,
    [values]
  )
  const progress = Math.round((completed / requiredFields.length) * 100)
  const missing = requiredFields.filter((field) => !values[field.id])
  const passwordsDoNotMatch = passwordConfirmation.length > 0 && password !== passwordConfirmation

  /**
   * Et bilde rett fra mobilkameraet er større enn det serverless-funksjonen
   * tar imot, så vi krymper det her og bytter ut fila i input-feltet. Da går
   * skjemaet som en helt vanlig POST videre.
   */
  async function handleImageChange(file: File | undefined) {
    if (!file) {
      setImageName(null)
      setValues((prev) => ({ ...prev, profile_image_file: false }))
      return
    }

    setImageName(file.name)
    setPreparingImage(true)
    try {
      const compressed = await compressImageFile(file)
      if (compressed !== file) replaceSelectedFile(compressed)

      const selected = imageInputRef.current?.files?.[0] ?? compressed
      if (selected.size > MAX_UPLOAD_BYTES) {
        toast.error("The image is too large. Choose a smaller picture.")
        if (imageInputRef.current) imageInputRef.current.value = ""
        setImageName(null)
        setValues((prev) => ({ ...prev, profile_image_file: false }))
        return
      }

      setImageName(selected.name)
      setValues((prev) => ({ ...prev, profile_image_file: true }))
    } finally {
      setPreparingImage(false)
    }
  }

  /** `input.files` kan bare settes med en DataTransfer — den mangler i eldre nettlesere. */
  function replaceSelectedFile(file: File) {
    const input = imageInputRef.current
    if (!input || typeof DataTransfer === "undefined") return
    try {
      const transfer = new DataTransfer()
      transfer.items.add(file)
      input.files = transfer.files
    } catch {
      // Beholder originalen; størrelsessjekken under sier fra hvis den er for stor.
    }
  }

  function updateTextField(field: RequiredFieldId, value: string) {
    setValues((prev) => ({
      ...prev,
      [field]: field === "password" ? value.length >= 8 : value.trim().length > 0,
    }))
  }

  return (
    <div
      className={cn('ev-surface mx-auto max-w-6xl overflow-hidden bg-[var(--ev-card)]', className)}
      style={{ borderRadius: 'var(--ev-r-card)' }}
      {...props}
    >
      <div className="grid lg:grid-cols-[280px_1fr]">
        <aside className="border-b border-[var(--ev-line)] p-6 lg:border-b-0 lg:border-r">
          <div className="lg:sticky lg:top-6">
            <Link href="/" className="text-[13px] text-[var(--ev-faint)] transition-colors hover:text-[var(--ev-text)]">Tickethalo</Link>
            <h2 className="mt-4 text-[1.35rem] font-semibold leading-tight tracking-[-0.02em]">Application</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--ev-muted)]">
              Your application is sent to the booking team for review.
            </p>

            <div className="mt-6 rounded-xl bg-[var(--ev-bg)] p-4">
              <div className="mb-2.5 flex items-center justify-between gap-3 text-[13px]">
                <span className="text-[var(--ev-muted)]">Completed</span>
                <span className="font-semibold tabular-nums">{completed}/{requiredFields.length}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ev-card-hover)]">
                <div
                  className="h-full rounded-full bg-[var(--ev-accent-fill)] transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--ev-muted)]">
                {missing.length === 0
                  ? "All required fields are filled out."
                  : `Missing: ${missing.map((field) => field.label).slice(0, 3).join(", ")}${missing.length > 3 ? ` +${missing.length - 3}` : ""}`}
              </p>
            </div>
          </div>
        </aside>

        <form action={action} method="post" encType="multipart/form-data" className="space-y-8 p-4 md:p-6">
          {successMessage && (
            <div className="rounded-xl bg-green-100 outline-green-500 outline-1 px-4 py-3 text-[14px] font-medium">
              {successMessage}
            </div>
          )}
          {errorMessage && (
            <div className="rounded-xl bg-[var(--ev-bg)] px-4 py-3 text-[14px] font-medium text-[var(--ev-accent)] ring-1 ring-inset ring-[var(--ev-accent)]/30">
              {errorMessage}
            </div>
          )}

          <section className="space-y-4">
            <SectionHeader icon={User} title="Identity" />
            <div className="grid gap-4 md:grid-cols-2">
              <LabeledInput icon={User} id="full_name" name="full_name" label="Full Name" autoComplete="name" onValue={(value) => updateTextField("full_name", value)} required />
              <LabeledInput icon={AtSign} id="email" name="email" label="Email" type="email" placeholder="name@example.com" autoComplete="email" onValue={(value) => updateTextField("email", value)} required />
              <LabeledInput icon={Lock} id="password" name="password" label="Password" type="password" minLength={8} autoComplete="new-password" onValue={(value) => { setPassword(value); updateTextField("password", value) }} required />
              <div>
                <LabeledInput
                  icon={Lock}
                  id="password_confirm"
                  name="password_confirm"
                  label="Confirm Password"
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  onValue={(value) => { setPasswordConfirmation(value); updateTextField("password_confirm", value) }}
                  aria-invalid={passwordsDoNotMatch}
                  required
                />
                {passwordsDoNotMatch && (
                  <p className="mt-2 text-[12px] text-[var(--ev-accent)]" role="alert">
                    Passwords do not match.
                  </p>
                )}
              </div>
              <LabeledInput icon={Phone} id="phone" name="phone" label="Phone" type="tel" autoComplete="tel" onValue={(value) => updateTextField("phone", value)} required />
              <div className="space-y-2">
                <label htmlFor="location" className="text-[13px] font-medium">Location</label>
                <LocationField id="location" value={location} onChange={selectLocation} />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[13px] font-medium">Language</p>
              <LanguageField
                value={languages}
                onChange={setLanguageSelection}
                suggestedFrom={suggestedFrom}
              />
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeader icon={Camera} title="Profile" />
            <label htmlFor="profile_image_file" className="flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-[var(--ev-line-strong)] p-4 transition-colors hover:bg-[var(--ev-bg)]">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[var(--ev-bg)] text-[var(--ev-muted)]">
                <ImagePlus className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">Headshot Picture</p>
                <p className="truncate text-[13px] text-[var(--ev-muted)]">
                  {preparingImage ? "Preparing image…" : (imageName ?? "This photo can be used on posters. Please choose a headshot.")}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-[var(--ev-text)] px-3.5 py-2 text-[13px] font-semibold text-[var(--ev-bg)]">Choose Image</span>
              <input
                id="profile_image_file"
                name="profile_image_file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                required
                className="sr-only"
                ref={imageInputRef}
                onChange={(event) => void handleImageChange(event.target.files?.[0])}
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="gender" className="text-[13px] font-medium">Gender</label>
                {/* Radix-rooten tar `name` og `required` og legger igjen et
                    skjult native-felt, så skjemaet postes som før. */}
                <Select
                  name="gender"
                  required
                  onValueChange={(value) => updateTextField("gender", value)}
                >
                  <SelectTrigger id="gender" className={selectClassName}>
                    <SelectValue placeholder="Select Gender" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDER_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                  <LabeledInput icon={Video} id="showcase" name="showcase" label="Showcase Video (optional)" type="url" placeholder="https://example.com/video" onValue={() => undefined} />
                <Label className="text-[12px] font-normal text-[var(--ev-faint)]">
                  We use it to assess your stage presence, and it will not be published outside our internal system.
                </Label>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="bio" className="text-[13px] font-medium">Short Bio</label>
              <textarea
                id="bio"
                name="bio"
                rows={4}
                className={textareaClassName}
                placeholder="Tell us briefly about stage experience, career highlights and style. This will be used in marketing when you are booked for a spot."
              />
            </div>
          </section>

          <section className="space-y-4 border-t border-[var(--ev-line)] pt-6">
            <SectionHeader icon={Globe2} title="Social Media Links" aside="optional" />
            <div className="grid gap-4 md:grid-cols-2">
              <Input id="instagram" name="instagram" type="url" placeholder="Instagram URL" className={fieldClassName} />
              <Input id="tiktok" name="tiktok" type="url" placeholder="TikTok URL" className={fieldClassName} />
              <Input id="facebook" name="facebook" type="url" placeholder="Facebook URL" className={fieldClassName} />
              <Input id="website" name="website" type="url" placeholder="Website URL" className={fieldClassName} />
            </div>
          </section>

          <div className="flex flex-col gap-3 border-t border-[var(--ev-line)] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] text-[var(--ev-muted)]">
              {missing.length === 0 ? "All set." : `${missing.length} fields are missing before submission.`}
            </p>
            <Button
              type="submit"
              className="h-11 rounded-full border-0 bg-[var(--ev-text)] px-5 text-[13px] font-semibold text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)] disabled:bg-[var(--ev-card-hover)] disabled:text-[var(--ev-faint)] sm:min-w-48"
              disabled={missing.length > 0 || passwordsDoNotMatch || preparingImage}
            >
              <BadgeCheck className="size-4" />
              Register Artist Profile
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
    <div className="flex items-center justify-between gap-3 border-b border-[var(--ev-line)] pb-3">
      <div className="flex items-center gap-2.5">
        <Icon className="size-4 text-[var(--ev-faint)]" />
        <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
      </div>
      {aside && <span className="text-[13px] text-[var(--ev-faint)]">{aside}</span>}
    </div>
  )
}

function LabeledInput({
  icon: Icon,
  label,
  onValue,
  ...props
}: React.ComponentProps<typeof Input> & {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onValue: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={props.id} className="text-[13px] font-medium">{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ev-faint)]" />
        <Input {...props} className={cn(fieldClassName, 'pl-9', props.className)} onChange={(event) => onValue(event.target.value)} />
      </div>
    </div>
  )
}
