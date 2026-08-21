"use client"

import { useEffect, useMemo, useState } from "react"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LocationField, type SelectedLocation } from "@/components/artist/location-field"
import { LanguageField } from "@/components/artist/language-field"
import { defaultLanguagesForCountry, lookupCountry } from "@/lib/geo"
import type { LanguageCode } from "@/lib/languages"
import { Label } from "../ui/label"

const requiredFields = [
  { id: "full_name", label: "Name" },
  { id: "email", label: "Email" },
  { id: "password", label: "Password" },
  { id: "profile_image_file", label: "Profile Picture" },
  { id: "phone", label: "Phone" },
  { id: "location", label: "Location" },
  { id: "language", label: "Language" },
  { id: "gender", label: "Gender" },
  { id: "youtube", label: "YouTube Video" },
] as const

type RequiredFieldId = (typeof requiredFields)[number]["id"]

const focusRing = 'outline-none ring-1 ring-inset ring-[var(--ev-line)] transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-[var(--ev-accent-fill)]'
const fieldClassName = `h-11 rounded-xl border-0 bg-[var(--ev-bg)] text-[14px] shadow-none ${focusRing}`
const selectClassName = `h-11 w-full appearance-none rounded-xl bg-[var(--ev-bg)] px-3.5 text-[14px] ${focusRing}`
const textareaClassName = `min-h-28 w-full rounded-xl bg-[var(--ev-bg)] px-3.5 py-3 text-[14px] leading-relaxed placeholder:text-[var(--ev-faint)] ${focusRing}`

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
    profile_image_file: false,
    phone: false,
    location: false,
    language: false,
    gender: false,
    youtube: false,
  })
  const [imageName, setImageName] = useState<string | null>(null)
  const [location, setLocation] = useState<SelectedLocation | null>(null)
  const [languages, setLanguages] = useState<LanguageCode[]>([])
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

        <form action={action} method="post" encType="multipart/form-data" className="space-y-8 p-6 md:p-8">
          {successMessage && (
            <div className="rounded-xl bg-[var(--ev-bg)] px-4 py-3 text-[14px] font-medium">
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
              <LabeledInput icon={Lock} id="password" name="password" label="Password" type="password" minLength={8} autoComplete="new-password" onValue={(value) => updateTextField("password", value)} required />
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
                <p className="text-[13px] font-medium">Profile Picture</p>
                <p className="truncate text-[13px] text-[var(--ev-muted)]">{imageName ?? "PNG, JPG or WebP"}</p>
              </div>
              <span className="shrink-0 rounded-full bg-[var(--ev-text)] px-3.5 py-2 text-[13px] font-semibold text-[var(--ev-bg)]">Choose Image</span>
              <input
                id="profile_image_file"
                name="profile_image_file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                required
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  setImageName(file?.name ?? null)
                  setValues((prev) => ({ ...prev, profile_image_file: Boolean(file) }))
                }}
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="gender" className="text-[13px] font-medium">Gender</label>
                <select
                  id="gender"
                  name="gender"
                  required
                  defaultValue=""
                  onChange={(event) => updateTextField("gender", event.target.value)}
                  className={selectClassName}
                >
                  <option value="" disabled>Select Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div className="space-y-2">
                <LabeledInput icon={Video} id="youtube" name="youtube" label="YouTube Video" type="url" placeholder="https://youtube.com/watch?v=..." onValue={(value) => updateTextField("youtube", value)} required />
                <Label className="text-[12px] font-normal text-[var(--ev-faint)]">
                    We use this video to assess your stage presence, and it will not be published outside our internal system.
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
                placeholder="Tell us briefly about your stage experience, style and type of show."
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
              disabled={missing.length > 0}
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