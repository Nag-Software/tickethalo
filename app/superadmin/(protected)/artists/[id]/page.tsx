import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ExternalLink } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { ToastActionForm } from '@/components/toast-action-form'
import { PendingButton } from '@/components/pending-button'
import { Section, formatDate } from '@/components/superadmin/ui'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ARTIST_ROLE_OPTIONS, canonicalRoleValues } from '@/lib/artist-roles'
import { COUNTRIES } from '@/lib/geo'
import { LANGUAGES, normalizeLanguages } from '@/lib/languages'
import { updateArtistAsSuperadminAction } from './actions'
import type { Artist } from '@/types/database'

export const metadata = { title: 'Edit comedian — Superadmin' }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATUS_OPTIONS = [
  { value: 'approved', label: 'Active' },
  { value: 'inactive', label: 'Inactive — paused' },
  { value: 'rejected', label: 'Rejected — off the platform' },
  { value: 'pending_review', label: 'Under review (old)' },
  { value: 'flagged', label: 'Flagged (old)' },
]

const GENDER_OPTIONS = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
]

const ENERGY_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'uncertain', label: 'Uncertain' },
]

const SOCIAL_FIELDS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'website', label: 'Website' },
  { key: 'showcase', label: 'Showcase video' },
]

const selectClass =
  'h-9 w-full rounded-4xl border border-input bg-input/30 px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

/**
 * Hele komikerraden, redigerbar for superadmin.
 *
 * Klubbene har sin egen profilside (`/admin-app/artists/[id]`) med det
 * klubben mener om komikeren. Her er det selve raden — det komikeren selv
 * skrev, og det bare superadmin skal kunne rette.
 */
export default async function SuperadminArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const { data } = await createAdminClient().from('artists').select('*').eq('id', id).maybeSingle()
  if (!data) notFound()
  const artist = data as Artist

  const name = artist.stage_name?.trim() || artist.full_name
  const languages = new Set<string>(normalizeLanguages(artist.languages))
  const roles = new Set<string>(canonicalRoleValues(artist.category))
  const social = artist.social_links ?? {}
  const countryKnown = !artist.country || COUNTRIES.some((country) => country.code === artist.country)

  return (
    <div>
      <AdminHeader title={name} description={artist.email} />

      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/superadmin/artists" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-4" />
            All comedians
          </Link>
          <Link
            href={`/admin-app/artists/${artist.id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Club profile
            <ExternalLink className="size-3" />
          </Link>
        </div>

        {/* Nøkkelen remounter skjemaet etter lagring, så feltene viser det som faktisk ble lagret. */}
        <ToastActionForm
          key={artist.updated_at}
          action={updateArtistAsSuperadminAction}
          successMessage="Comedian saved."
          className="flex flex-col gap-8"
        >
          <input type="hidden" name="artist_id" value={artist.id} />

          <Section title="Name and contact">
            <Card>
              <Field label="Full name" htmlFor="full_name">
                <Input id="full_name" name="full_name" defaultValue={artist.full_name} required />
              </Field>
              <Field label="Stage name" htmlFor="stage_name">
                <Input id="stage_name" name="stage_name" defaultValue={artist.stage_name ?? ''} />
              </Field>
              <Field label="Email" htmlFor="email">
                <Input id="email" name="email" type="email" defaultValue={artist.email} required />
                {artist.auth_user_id && (
                  <label className="mt-1.5 flex items-start gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" name="sync_login_email" defaultChecked className="mt-0.5" />
                    Also change the sign-in email. If the profile is linked to a club sign-in, that sign-in is changed.
                  </label>
                )}
              </Field>
              <Field label="Phone" htmlFor="phone">
                <Input id="phone" name="phone" defaultValue={artist.phone ?? ''} />
              </Field>
              <Field label="WhatsApp (with country code, digits only)" htmlFor="whatsapp_number">
                <Input id="whatsapp_number" name="whatsapp_number" defaultValue={artist.whatsapp_number ?? ''} placeholder="4791234567" />
                <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" name="whatsapp_consent" defaultChecked={Boolean(artist.whatsapp_consent_at)} />
                  Consent to share the number with clubs
                  {artist.whatsapp_consent_at && ` (given ${formatDate(artist.whatsapp_consent_at)})`}
                </label>
              </Field>
              <Field label="Bank account number" htmlFor="bank_account_number">
                <Input id="bank_account_number" name="bank_account_number" defaultValue={artist.bank_account_number ?? ''} />
              </Field>
            </Card>
          </Section>

          <Section title="Location, language and gender">
            <Card>
              <Field label="City" htmlFor="city">
                <Input id="city" name="city" defaultValue={artist.city ?? ''} />
              </Field>
              <Field label="Country" htmlFor="country">
                <select id="country" name="country" defaultValue={artist.country ?? ''} className={selectClass}>
                  <option value="">Not set</option>
                  {!countryKnown && <option value={artist.country ?? ''}>{artist.country} (unknown code)</option>}
                  {COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>{country.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Gender" htmlFor="gender">
                <select id="gender" name="gender" defaultValue={artist.gender ?? ''} className={selectClass}>
                  <option value="">Not set</option>
                  {GENDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-medium">Languages</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {LANGUAGES.map((language) => (
                    <label key={language.code} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" name="language" value={language.code} defaultChecked={languages.has(language.code)} />
                      {language.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </Card>
          </Section>

          <Section title="Profile">
            <Card>
              <div className="flex items-center gap-4 sm:col-span-2">
                <Avatar className="size-16">
                  {artist.profile_image_url && <AvatarImage src={artist.profile_image_url} alt="" />}
                  <AvatarFallback>{name.charAt(0).toUpperCase() || '?'}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 gap-1.5">
                  <Label htmlFor="profile_image_file">Upload new image</Label>
                  <Input id="profile_image_file" name="profile_image_file" type="file" accept="image/*" />
                </div>
              </div>
              <Field label="Image URL" htmlFor="profile_image_url" wide>
                <Input id="profile_image_url" name="profile_image_url" defaultValue={artist.profile_image_url ?? ''} />
              </Field>
              <Field label="Bio" htmlFor="bio" wide>
                <Textarea id="bio" name="bio" rows={5} defaultValue={artist.bio ?? ''} />
              </Field>
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-medium">Roles</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {ARTIST_ROLE_OPTIONS.map((role) => (
                    <label key={role.value} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" name="category" value={role.value} defaultChecked={roles.has(role.value)} />
                      {role.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </Card>
          </Section>

          <Section title="Links" description="Saved exactly as written — enter the full link.">
            <Card>
              {SOCIAL_FIELDS.map((field) => (
                <Field key={field.key} label={field.label} htmlFor={`social_${field.key}`}>
                  <Input id={`social_${field.key}`} name={`social_${field.key}`} defaultValue={social[field.key] ?? ''} />
                </Field>
              ))}
            </Card>
          </Section>

          <Section
            title="Status and moderation"
            description="Inactive and rejected take the comedian out of the portal and out of booking at every club. Upcoming bookings are not removed automatically."
          >
            <Card>
              <Field label="Status" htmlFor="status">
                <select id="status" name="status" defaultValue={artist.status} className={selectClass}>
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Energy (old global field)" htmlFor="admin_energy_level">
                <select id="admin_energy_level" name="admin_energy_level" defaultValue={artist.admin_energy_level ?? ''} className={selectClass}>
                  <option value="">Not set</option>
                  {ENERGY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Admin score (retired, not used)" htmlFor="admin_score">
                <Input id="admin_score" name="admin_score" inputMode="decimal" defaultValue={artist.admin_score ?? ''} />
              </Field>
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Flag (old global field)</span>
                <label className="flex h-9 items-center gap-2 text-sm">
                  <input type="checkbox" name="is_flagged" defaultChecked={artist.is_flagged} />
                  Flagged
                  {artist.flagged_at && <span className="text-xs text-muted-foreground">({formatDate(artist.flagged_at)})</span>}
                </label>
              </div>
              <Field label="Flag reason" htmlFor="flag_reason" wide>
                <Input id="flag_reason" name="flag_reason" defaultValue={artist.flag_reason ?? ''} />
              </Field>
              <Field label="Admin notes" htmlFor="admin_notes" wide>
                <Textarea id="admin_notes" name="admin_notes" rows={3} defaultValue={artist.admin_notes ?? ''} />
              </Field>
            </Card>
          </Section>

          <div className="sticky bottom-0 -mx-6 flex justify-end border-t bg-background/95 px-6 py-3 backdrop-blur">
            <PendingButton type="submit" pendingLabel="Saving…">Save changes</PendingButton>
          </div>
        </ToastActionForm>

        <Section title="System fields" description="Can't be changed here — they tie the profile to sign-ins.">
          <dl className="grid gap-x-6 gap-y-2 rounded-xl border bg-card p-4 text-xs sm:grid-cols-2">
            <ReadOnly label="ID" value={artist.id} />
            <ReadOnly label="Sign-in (auth_user_id)" value={artist.auth_user_id} />
            <ReadOnly label="Blocked own sign-in" value={artist.linked_from_auth_user_id ?? null} />
            <ReadOnly label="Registered" value={formatDate(artist.created_at)} />
            <ReadOnly label="Last changed" value={formatDate(artist.updated_at)} />
          </dl>
        </Section>
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2">{children}</div>
}

function Field({
  label,
  htmlFor,
  wide,
  children,
}: {
  label: string
  htmlFor: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={wide ? 'grid gap-1.5 sm:col-span-2' : 'grid gap-1.5'}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function ReadOnly({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono">{value ?? '—'}</dd>
    </div>
  )
}
