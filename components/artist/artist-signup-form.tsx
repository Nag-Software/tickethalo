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
import type { ArtistSignupDraft } from '@/lib/artist-registration-draft'
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

const fieldClassName = 'h-11 rounded-none border-2 border-zinc-950 bg-white/70 shadow-none'
const selectClassName = 'h-11 w-full rounded-none border-2 border-zinc-950 bg-white/70 px-3 text-sm outline-none transition-colors focus-visible:border-zinc-950 focus-visible:ring-0'
const textareaClassName = 'min-h-28 w-full rounded-none border-2 border-zinc-950 bg-white/70 px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-500 focus-visible:border-zinc-950 focus-visible:ring-0'

function buildInitialValues(draft?: ArtistSignupDraft): Record<RequiredFieldId, boolean> {
  const completionMode = draft?.mode === 'complete'

  return {
    full_name: Boolean(draft?.full_name?.trim()),
    stage_name: Boolean(draft?.stage_name?.trim()),
    email: Boolean(draft?.email?.trim()),
    password: completionMode,
    profile_image_file: Boolean(draft?.hasProfileImage),
    phone: Boolean(draft?.phone?.trim()),
    language: Boolean(draft?.language),
    gender: Boolean(draft?.gender),
    category: (draft?.category?.length ?? 0) > 0,
    youtube: Boolean(draft?.youtube?.trim()),
  }
}

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
  const [values, setValues] = useState<Record<RequiredFieldId, boolean>>(() => buildInitialValues(draft))
  const [selectedCategories, setSelectedCategories] = useState<string[]>(draft?.category ?? [])
  const [imageName, setImageName] = useState<string | null>(
    draft?.hasProfileImage ? 'Eksisterende profilbilde' : null,
  )

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
    <div className={cn('mx-auto max-w-6xl border-2 border-zinc-950 bg-[#fbf7ec] shadow-[8px_8px_0_rgba(24,24,27,0.14)]', className)} {...props}>
      <div className="grid lg:grid-cols-[260px_1fr]">
        <aside className="border-b-2 border-zinc-950 bg-[#f3ead9] p-6 lg:border-b-0 lg:border-r-2">
          <div className="lg:sticky lg:top-6">
            <Link href="/" className="inline-flex border border-zinc-950 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-950">humor.events</Link>
            <h1 className="mt-6 text-3xl font-black uppercase leading-none tracking-tight">
              {completionMode ? 'Fullfør profil' : 'Søknad'}
            </h1>
            <p className="mt-3 text-sm font-medium leading-6 text-zinc-600">
              {completionMode
                ? 'Kontoen din finnes allerede. Fyll ut resten av profilen for å bli vurdert til bookinger.'
                : 'Søknaden sendes til booking-teamet for vurdering.'}
            </p>

            <div className="mt-6 border-2 border-zinc-950 bg-white/60 p-4">
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-bold uppercase tracking-[0.16em] text-zinc-500">Registrering</span>
                <span className="font-black text-zinc-950">{completed}/{requiredFields.length}</span>
              </div>
              <div className="h-2 overflow-hidden border border-zinc-950 bg-[#f3ead9]">
                <div
                  className="h-full bg-[#b83224] transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-3 text-xs font-medium leading-5 text-zinc-600">
                {missing.length === 0
                  ? "Alt obligatorisk er fylt ut."
                  : `Mangler: ${missing.map((field) => field.label).slice(0, 3).join(", ")}${missing.length > 3 ? ` +${missing.length - 3}` : ""}`}
              </p>
            </div>
          </div>
        </aside>

        <form action={action} method="post" encType="multipart/form-data" className="space-y-8 p-6 md:p-8">
          {completionMode && draft?.hasProfileImage && (
            <input type="hidden" name="existing_profile_image" value="1" />
          )}
          {completionMode && (
            <div className="border-2 border-zinc-950 bg-[#f3ead9] px-4 py-3 text-sm font-medium text-zinc-700">
              Du er innlogget som {draft?.email}. Eksisterende info er fylt inn — fullfør feltene som mangler.
            </div>
          )}
          {successMessage && (
            <div className="border-2 border-zinc-950 bg-white px-3 py-2 text-sm font-medium text-zinc-950">
              {successMessage}
            </div>
          )}
          {errorMessage && (
            <div className="border-2 border-[#b83224] bg-white px-3 py-2 text-sm font-medium text-[#b83224]">
              {errorMessage}
            </div>
          )}

          <section className="space-y-4">
            <SectionHeader icon={User} title="Identitet" />
            <div className="grid gap-4 md:grid-cols-2">
              <LabeledInput icon={User} id="full_name" name="full_name" label="Fullt navn" autoComplete="name" defaultValue={draft?.full_name} onValue={(value) => updateTextField("full_name", value)} required />
              <LabeledInput icon={Clapperboard} id="stage_name" name="stage_name" label="Scenenavn" autoComplete="organization-title" defaultValue={draft?.stage_name} onValue={(value) => updateTextField("stage_name", value)} required />
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
                  updateTextField('password', value)
                }}
                required={!completionMode}
              />
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
            <label htmlFor="profile_image_file" className="flex cursor-pointer items-center gap-4 border-2 border-dashed border-zinc-950 bg-[#f3ead9] p-4 transition-colors hover:bg-white/60">
              <div className="flex size-12 items-center justify-center border-2 border-zinc-950 bg-white/70 text-zinc-500">
                <ImagePlus className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-zinc-500">Profilbilde</p>
                <p className="truncate text-sm font-medium text-zinc-700">
                  {imageName ?? (draft?.hasProfileImage ? 'Eksisterende profilbilde lagret' : 'PNG, JPG eller WebP')}
                </p>
              </div>
              <span className="border-2 border-zinc-950 bg-white px-3 py-1.5 text-sm font-bold">
                {draft?.hasProfileImage ? 'Bytt bilde' : 'Velg bilde'}
              </span>
              <input
                id="profile_image_file"
                name="profile_image_file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                required={!draft?.hasProfileImage}
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
                <LabeledInput icon={Video} id="youtube" name="youtube" label="YouTube-video" type="url" placeholder="https://youtube.com/watch?v=..." defaultValue={draft?.youtube} onValue={(value) => updateTextField("youtube", value)} required />
                <Label className="text-xs text-muted-foreground">
                    Vi benytter denne videoen til å vurdere ditt sceneutrykk, og den vil ikke bli publisert utenfor vårt interne system.
                </Label>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Kategori</p>
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => {
                  const checked = selectedCategories.includes(category)
                  return (
                    <label
                      key={category}
                      className={cn(
                        'cursor-pointer border-2 px-3 py-1.5 text-sm font-bold transition-colors',
                        checked ? 'border-zinc-950 bg-zinc-950 text-white' : 'border-zinc-950 bg-white/70 text-zinc-950 hover:bg-[#f3ead9]'
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

          <section className="space-y-4 border-t-2 border-zinc-950 pt-6">
            <SectionHeader icon={Globe2} title="SoMe-lenker" aside="valgfritt" />
            <div className="grid gap-4 md:grid-cols-2">
              <Input id="instagram" name="instagram" type="url" placeholder="Instagram URL" defaultValue={draft?.instagram} className={fieldClassName} />
              <Input id="tiktok" name="tiktok" type="url" placeholder="TikTok URL" defaultValue={draft?.tiktok} className={fieldClassName} />
              <Input id="facebook" name="facebook" type="url" placeholder="Facebook URL" defaultValue={draft?.facebook} className={fieldClassName} />
              <Input id="website" name="website" type="url" placeholder="Nettside URL" defaultValue={draft?.website} className={fieldClassName} />
            </div>
          </section>

          <div className="flex flex-col gap-3 border-t-2 border-zinc-950 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-zinc-600">
              {missing.length === 0 ? "Alt klart." : `${missing.length} felt mangler før innsending.`}
            </p>
            <Button
              type="submit"
              className="h-11 rounded-none border-2 border-zinc-950 bg-[#b83224] px-5 font-bold text-white shadow-[4px_4px_0_#18181b] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:bg-[#9f2d21] hover:shadow-[2px_2px_0_#18181b] disabled:translate-x-0 disabled:translate-y-0 disabled:opacity-45 disabled:shadow-none sm:min-w-48"
              disabled={missing.length > 0}
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
    <div className="flex items-center justify-between gap-3 border-b border-zinc-950/15 pb-3">
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center border border-zinc-950 bg-white/70 text-zinc-500">
          <Icon className="size-4" />
        </div>
        <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">{title}</h2>
      </div>
      {aside && <span className="text-xs font-medium text-zinc-500">{aside}</span>}
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
      <label htmlFor={props.id} className="text-sm font-medium text-zinc-800">{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
        <Input
          {...props}
          defaultValue={defaultValue}
          readOnly={readOnly}
          className={cn(fieldClassName, 'pl-9', readOnly && 'bg-zinc-100 text-zinc-600', props.className)}
          onChange={(event) => onValue(event.target.value)}
        />
      </div>
    </div>
  )
}