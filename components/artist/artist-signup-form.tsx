"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  AtSign,
  BadgeCheck,
  Camera,
  Clapperboard,
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
import { ARTIST_ROLE_LABEL_OPTIONS } from '@/lib/artist-roles'
import { Label } from "../ui/label"

const categories = ARTIST_ROLE_LABEL_OPTIONS

const requiredFields = [
  { id: "full_name", label: "Navn" },
  { id: "stage_name", label: "Scenenavn" },
  { id: "email", label: "E-post" },
  { id: "password", label: "Passord" },
  { id: "profile_image_file", label: "Profilbilde" },
  { id: "phone", label: "Telefon" },
  { id: "language", label: "Språk" },
  { id: "gender", label: "Kjønn" },
  { id: "category", label: "Kategori" },
  { id: "youtube", label: "YouTube-video" },
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
    stage_name: false,
    email: false,
    password: false,
    profile_image_file: false,
    phone: false,
    language: false,
    gender: false,
    category: false,
    youtube: false,
  })
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [imageName, setImageName] = useState<string | null>(null)

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

  function toggleCategory(category: string) {
    setSelectedCategories((prev) => {
      const next = prev.includes(category)
        ? prev.filter((item) => item !== category)
        : [...prev, category]
      setValues((current) => ({ ...current, category: next.length > 0 }))
      return next
    })
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
            <Link href="/" className="text-[13px] text-[var(--ev-faint)] transition-colors hover:text-[var(--ev-text)]">humor.events</Link>
            <h2 className="mt-4 text-[1.35rem] font-semibold leading-tight tracking-[-0.02em]">Søknad</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--ev-muted)]">
              Søknaden sendes til bookingteamet for vurdering.
            </p>

            <div className="mt-6 rounded-xl bg-[var(--ev-bg)] p-4">
              <div className="mb-2.5 flex items-center justify-between gap-3 text-[13px]">
                <span className="text-[var(--ev-muted)]">Utfylt</span>
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
                  ? "Alt obligatorisk er fylt ut."
                  : `Mangler: ${missing.map((field) => field.label).slice(0, 3).join(", ")}${missing.length > 3 ? ` +${missing.length - 3}` : ""}`}
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
            <SectionHeader icon={User} title="Identitet" />
            <div className="grid gap-4 md:grid-cols-2">
              <LabeledInput icon={User} id="full_name" name="full_name" label="Fullt navn" autoComplete="name" onValue={(value) => updateTextField("full_name", value)} required />
              <LabeledInput icon={Clapperboard} id="stage_name" name="stage_name" label="Scenenavn" autoComplete="organization-title" onValue={(value) => updateTextField("stage_name", value)} required />
              <LabeledInput icon={AtSign} id="email" name="email" label="E-post" type="email" placeholder="navn@eksempel.no" autoComplete="email" onValue={(value) => updateTextField("email", value)} required />
              <LabeledInput icon={Lock} id="password" name="password" label="Passord" type="password" minLength={8} autoComplete="new-password" onValue={(value) => updateTextField("password", value)} required />
              <LabeledInput icon={Phone} id="phone" name="phone" label="Telefon" type="tel" autoComplete="tel" onValue={(value) => updateTextField("phone", value)} required />
              <div className="space-y-2">
                <label htmlFor="language" className="text-[13px] font-medium">Språk</label>
                <select
                  id="language"
                  name="language"
                  required
                  defaultValue=""
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
            <label htmlFor="profile_image_file" className="flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-[var(--ev-line-strong)] p-4 transition-colors hover:bg-[var(--ev-bg)]">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[var(--ev-bg)] text-[var(--ev-muted)]">
                <ImagePlus className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">Profilbilde</p>
                <p className="truncate text-[13px] text-[var(--ev-muted)]">{imageName ?? "PNG, JPG eller WebP"}</p>
              </div>
              <span className="shrink-0 rounded-full bg-[var(--ev-text)] px-3.5 py-2 text-[13px] font-semibold text-[var(--ev-bg)]">Velg bilde</span>
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
                <label htmlFor="gender" className="text-[13px] font-medium">Kjønn</label>
                <select
                  id="gender"
                  name="gender"
                  required
                  defaultValue=""
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
                <LabeledInput icon={Video} id="youtube" name="youtube" label="YouTube-video" type="url" placeholder="https://youtube.com/watch?v=..." onValue={(value) => updateTextField("youtube", value)} required />
                <Label className="text-[12px] font-normal text-[var(--ev-faint)]">
                    Vi benytter denne videoen til å vurdere ditt sceneutrykk, og den vil ikke bli publisert utenfor vårt interne system.
                </Label>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[13px] font-medium">Kategori</p>
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => {
                  const checked = selectedCategories.includes(category)
                  return (
                    <label
                      key={category}
                      className={cn(
                        'cursor-pointer rounded-full px-3.5 py-1.5 text-[13px] transition-colors',
                        checked
                          ? 'bg-[var(--ev-accent-fill)] font-semibold text-[var(--ev-accent-ink)]'
                          : 'bg-[var(--ev-bg)] text-[var(--ev-muted)] ring-1 ring-inset ring-[var(--ev-line)] hover:text-[var(--ev-text)]'
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
              <label htmlFor="bio" className="text-[13px] font-medium">Kort bio</label>
              <textarea
                id="bio"
                name="bio"
                rows={4}
                className={textareaClassName}
                placeholder="Fortell kort om sceneerfaring, stil og type show."
              />
            </div>
          </section>

          <section className="space-y-4 border-t border-[var(--ev-line)] pt-6">
            <SectionHeader icon={Globe2} title="SoMe-lenker" aside="valgfritt" />
            <div className="grid gap-4 md:grid-cols-2">
              <Input id="instagram" name="instagram" type="url" placeholder="Instagram URL" className={fieldClassName} />
              <Input id="tiktok" name="tiktok" type="url" placeholder="TikTok URL" className={fieldClassName} />
              <Input id="facebook" name="facebook" type="url" placeholder="Facebook URL" className={fieldClassName} />
              <Input id="website" name="website" type="url" placeholder="Nettside URL" className={fieldClassName} />
            </div>
          </section>

          <div className="flex flex-col gap-3 border-t border-[var(--ev-line)] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] text-[var(--ev-muted)]">
              {missing.length === 0 ? "Alt klart." : `${missing.length} felt mangler før innsending.`}
            </p>
            <Button
              type="submit"
              className="h-11 rounded-full border-0 bg-[var(--ev-text)] px-5 text-[13px] font-semibold text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)] disabled:bg-[var(--ev-card-hover)] disabled:text-[var(--ev-faint)] sm:min-w-48"
              disabled={missing.length > 0}
            >
              <BadgeCheck className="size-4" />
              Registrer artistprofil
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