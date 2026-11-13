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

export const metadata = { title: 'Rediger komiker — Superadmin' }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATUS_OPTIONS = [
  { value: 'approved', label: 'Aktiv' },
  { value: 'inactive', label: 'Inaktiv — satt på pause' },
  { value: 'rejected', label: 'Avvist — ute av plattformen' },
  { value: 'pending_review', label: 'Til vurdering (gammel)' },
  { value: 'flagged', label: 'Flagget (gammel)' },
]

const GENDER_OPTIONS = [
  { value: 'woman', label: 'Kvinne' },
  { value: 'man', label: 'Mann' },
  { value: 'non_binary', label: 'Ikke-binær' },
  { value: 'prefer_not_to_say', label: 'Vil ikke si' },
]

const ENERGY_OPTIONS = [
  { value: 'high', label: 'Høy' },
  { value: 'medium', label: 'Middels' },
  { value: 'low', label: 'Lav' },
  { value: 'uncertain', label: 'Usikker' },
]

const SOCIAL_FIELDS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'website', label: 'Nettside' },
  { key: 'showcase', label: 'Showcase-video' },
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
            Alle komikere
          </Link>
          <Link
            href={`/admin-app/artists/${artist.id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Klubbprofilen
            <ExternalLink className="size-3" />
          </Link>
        </div>

        {/* Nøkkelen remounter skjemaet etter lagring, så feltene viser det som faktisk ble lagret. */}
        <ToastActionForm
          key={artist.updated_at}
          action={updateArtistAsSuperadminAction}
          successMessage="Komikeren er lagret."
          className="flex flex-col gap-8"
        >
          <input type="hidden" name="artist_id" value={artist.id} />

          <Section title="Navn og kontakt">
            <Card>
              <Field label="Fullt navn" htmlFor="full_name">
                <Input id="full_name" name="full_name" defaultValue={artist.full_name} required />
              </Field>
              <Field label="Scenenavn" htmlFor="stage_name">
                <Input id="stage_name" name="stage_name" defaultValue={artist.stage_name ?? ''} />
              </Field>
              <Field label="E-post" htmlFor="email">
                <Input id="email" name="email" type="email" defaultValue={artist.email} required />
                {artist.auth_user_id && (
                  <label className="mt-1.5 flex items-start gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" name="sync_login_email" defaultChecked className="mt-0.5" />
                    Endre også innloggings-e-posten. Er profilen koblet til en klubbinnlogging, endres den innloggingen.
                  </label>
                )}
              </Field>
              <Field label="Telefon" htmlFor="phone">
                <Input id="phone" name="phone" defaultValue={artist.phone ?? ''} />
              </Field>
              <Field label="WhatsApp (med landskode, bare sifre)" htmlFor="whatsapp_number">
                <Input id="whatsapp_number" name="whatsapp_number" defaultValue={artist.whatsapp_number ?? ''} placeholder="4791234567" />
                <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" name="whatsapp_consent" defaultChecked={Boolean(artist.whatsapp_consent_at)} />
                  Samtykke til å dele nummeret med klubber
                  {artist.whatsapp_consent_at && ` (gitt ${formatDate(artist.whatsapp_consent_at)})`}
                </label>
              </Field>
              <Field label="Kontonummer" htmlFor="bank_account_number">
                <Input id="bank_account_number" name="bank_account_number" defaultValue={artist.bank_account_number ?? ''} />
              </Field>
            </Card>
          </Section>

          <Section title="Sted, språk og kjønn">
            <Card>
              <Field label="By" htmlFor="city">
                <Input id="city" name="city" defaultValue={artist.city ?? ''} />
              </Field>
              <Field label="Land" htmlFor="country">
                <select id="country" name="country" defaultValue={artist.country ?? ''} className={selectClass}>
                  <option value="">Ikke satt</option>
                  {!countryKnown && <option value={artist.country ?? ''}>{artist.country} (ukjent kode)</option>}
                  {COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>{country.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Kjønn" htmlFor="gender">
                <select id="gender" name="gender" defaultValue={artist.gender ?? ''} className={selectClass}>
                  <option value="">Ikke satt</option>
                  {GENDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-medium">Språk</legend>
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

          <Section title="Profil">
            <Card>
              <div className="flex items-center gap-4 sm:col-span-2">
                <Avatar className="size-16">
                  {artist.profile_image_url && <AvatarImage src={artist.profile_image_url} alt="" />}
                  <AvatarFallback>{name.charAt(0).toUpperCase() || '?'}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 gap-1.5">
                  <Label htmlFor="profile_image_file">Last opp nytt bilde</Label>
                  <Input id="profile_image_file" name="profile_image_file" type="file" accept="image/*" />
                </div>
              </div>
              <Field label="Bilde-URL" htmlFor="profile_image_url" wide>
                <Input id="profile_image_url" name="profile_image_url" defaultValue={artist.profile_image_url ?? ''} />
              </Field>
              <Field label="Bio" htmlFor="bio" wide>
                <Textarea id="bio" name="bio" rows={5} defaultValue={artist.bio ?? ''} />
              </Field>
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-medium">Roller</legend>
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

          <Section title="Lenker" description="Lagres nøyaktig som skrevet — skriv hele lenken.">
            <Card>
              {SOCIAL_FIELDS.map((field) => (
                <Field key={field.key} label={field.label} htmlFor={`social_${field.key}`}>
                  <Input id={`social_${field.key}`} name={`social_${field.key}`} defaultValue={social[field.key] ?? ''} />
                </Field>
              ))}
            </Card>
          </Section>

          <Section
            title="Status og moderering"
            description="Inaktiv og avvist tar komikeren ut av portalen og bookingen hos alle klubber. Kommende bookinger fjernes ikke automatisk."
          >
            <Card>
              <Field label="Status" htmlFor="status">
                <select id="status" name="status" defaultValue={artist.status} className={selectClass}>
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Energi (gammelt globalt felt)" htmlFor="admin_energy_level">
                <select id="admin_energy_level" name="admin_energy_level" defaultValue={artist.admin_energy_level ?? ''} className={selectClass}>
                  <option value="">Ikke satt</option>
                  {ENERGY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Admin-score (utgått, brukes ikke)" htmlFor="admin_score">
                <Input id="admin_score" name="admin_score" inputMode="decimal" defaultValue={artist.admin_score ?? ''} />
              </Field>
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Flagg (gammelt globalt felt)</span>
                <label className="flex h-9 items-center gap-2 text-sm">
                  <input type="checkbox" name="is_flagged" defaultChecked={artist.is_flagged} />
                  Flagget
                  {artist.flagged_at && <span className="text-xs text-muted-foreground">({formatDate(artist.flagged_at)})</span>}
                </label>
              </div>
              <Field label="Flagg-grunn" htmlFor="flag_reason" wide>
                <Input id="flag_reason" name="flag_reason" defaultValue={artist.flag_reason ?? ''} />
              </Field>
              <Field label="Admin-notater" htmlFor="admin_notes" wide>
                <Textarea id="admin_notes" name="admin_notes" rows={3} defaultValue={artist.admin_notes ?? ''} />
              </Field>
            </Card>
          </Section>

          <div className="sticky bottom-0 -mx-6 flex justify-end border-t bg-background/95 px-6 py-3 backdrop-blur">
            <PendingButton type="submit" pendingLabel="Lagrer…">Lagre endringer</PendingButton>
          </div>
        </ToastActionForm>

        <Section title="Systemfelt" description="Kan ikke endres her — de knytter profilen til innlogginger.">
          <dl className="grid gap-x-6 gap-y-2 rounded-xl border bg-card p-4 text-xs sm:grid-cols-2">
            <ReadOnly label="ID" value={artist.id} />
            <ReadOnly label="Innlogging (auth_user_id)" value={artist.auth_user_id} />
            <ReadOnly label="Sperret egen innlogging" value={artist.linked_from_auth_user_id ?? null} />
            <ReadOnly label="Registrert" value={formatDate(artist.created_at)} />
            <ReadOnly label="Sist endret" value={formatDate(artist.updated_at)} />
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
