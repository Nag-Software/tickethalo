"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ARTIST_ROLE_OPTIONS } from "@/lib/artist-roles"
import { HugeiconsIcon } from "@hugeicons/react"
import { LayoutBottomIcon } from "@hugeicons/core-free-icons"

export function SignupForm({
  className,
  action = "/signup/submit",
  errorMessage,
  successMessage,
  ...props
}: React.ComponentProps<"div"> & {
  action?: string
  errorMessage?: string
  successMessage?: string
}) {
  useEffect(() => {
    if (errorMessage) toast.error(errorMessage)
    if (successMessage) toast.success(successMessage)
  }, [errorMessage, successMessage])

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form action={action} method="post" encType="multipart/form-data">
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <a
              href="/signup"
              className="flex flex-col items-center gap-2 font-medium"
            >
              <div className="flex size-8 items-center justify-center rounded-md">
                <HugeiconsIcon icon={LayoutBottomIcon} strokeWidth={2} className="size-6" />
              </div>
              <span className="sr-only">humor.events</span>
            </a>
            <h1 className="text-xl font-bold">Registrer artistprofil</h1>
            <FieldDescription>
              Søknaden sendes til booking-teamet for vurdering.
            </FieldDescription>
          </div>
          {successMessage && (
            <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
              {successMessage}
            </div>
          )}
          {errorMessage && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </div>
          )}
          <Field>
            <FieldLabel htmlFor="full_name">Fullt navn</FieldLabel>
            <Input id="full_name" name="full_name" type="text" autoComplete="name" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="stage_name">Scenenavn</FieldLabel>
            <Input id="stage_name" name="stage_name" type="text" autoComplete="organization-title" />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">E-post</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="m@example.com"
              autoComplete="email"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Passord</FieldLabel>
            <Input id="password" name="password" type="password" minLength={8} autoComplete="new-password" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="profile_image_file">Profilbilde</FieldLabel>
            <Input id="profile_image_file" name="profile_image_file" type="file" accept="image/png,image/jpeg,image/webp" />
          </Field>
          <Field className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <FieldLabel htmlFor="phone">Telefon</FieldLabel>
              <Input id="phone" name="phone" type="tel" autoComplete="tel" />
            </div>
            <div className="flex flex-col gap-3">
              <FieldLabel htmlFor="language">Språk</FieldLabel>
              <select id="language" name="language" defaultValue="Norsk" className="h-9 w-full rounded-4xl border border-input bg-input/30 px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <option>Norsk</option>
                <option>Engelsk</option>
                <option>Begge</option>
              </select>
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="category">Kategori</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {ARTIST_ROLE_OPTIONS.map((role) => (
                <label key={role.value} className="cursor-pointer">
                  <input
                    id={role.value === 'headliner' ? 'category' : undefined}
                    type="checkbox"
                    name="category"
                    value={role.value}
                    defaultChecked={role.value === 'stand-up'}
                    className="sr-only peer"
                  />
                  <span className="inline-flex items-center rounded-full border border-input bg-input/30 px-3 py-1 text-sm transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground hover:bg-muted">
                    {role.label}
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="bio">Kort bio</FieldLabel>
            <textarea
              id="bio"
              name="bio"
              rows={4}
              className="min-h-24 w-full rounded-2xl border border-input bg-input/30 px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Fortell kort om sceneerfaring, stil og type show."
            />
          </Field>
          <FieldSeparator>Lenker</FieldSeparator>
          <Field className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <FieldLabel htmlFor="instagram">Instagram</FieldLabel>
              <Input id="instagram" name="instagram" type="url" placeholder="https://" />
            </div>
            <div className="flex flex-col gap-3">
              <FieldLabel htmlFor="tiktok">TikTok</FieldLabel>
              <Input id="tiktok" name="tiktok" type="url" placeholder="https://" />
            </div>
            <div className="flex flex-col gap-3">
              <FieldLabel htmlFor="youtube">YouTube</FieldLabel>
              <Input id="youtube" name="youtube" type="url" placeholder="https://" />
            </div>
            <div className="flex flex-col gap-3">
              <FieldLabel htmlFor="facebook">Facebook</FieldLabel>
              <Input id="facebook" name="facebook" type="url" placeholder="https://" />
            </div>
            <div className="flex flex-col gap-3">
              <FieldLabel htmlFor="website">Nettside</FieldLabel>
              <Input id="website" name="website" type="url" placeholder="https://" />
            </div>
          </Field>
          <Field>
            <Button type="submit" size="lg" className="w-full">Registrer artistprofil</Button>
          </Field>
        </FieldGroup>
      </form>
      <FieldDescription className="px-6 text-center">
        Allerede registrert? <a href="/artist-app/login">Logg inn</a>.
      </FieldDescription>
    </div>
  )
}
