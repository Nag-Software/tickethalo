import Image from 'next/image'
import { ToastActionForm } from '@/components/toast-action-form'
import { YouTubePlayerCard } from '@/components/youtube-player-card'
import { updateArtistProfileAction } from '../actions'
import { getCurrentArtist } from '@/lib/artist-portal'
import { ARTIST_ROLE_OPTIONS, normalizeArtistRoleList } from '@/lib/artist-roles'
import { shouldBypassImageOptimization } from '@/lib/utils'
import { Chip, DataRow, PageHeader, Panel, portalButton } from '@/components/artist/portal-ui'

const inputClass =
  'h-10 w-full rounded-xl bg-[var(--ev-bg)] px-3.5 text-[14px] text-[var(--ev-text)] outline-none ring-1 ring-inset ring-[var(--ev-line)] transition-[box-shadow] placeholder:text-[var(--ev-faint)] focus:ring-2 focus:ring-[var(--ev-accent-fill)]'

export default async function ArtistProfilePage() {
  const { artist } = await getCurrentArtist()
  const links = artist.social_links ?? {}
  const selectedCategories = new Set(normalizeArtistRoleList(artist.category))

  return (
    <>
      <PageHeader
        title="Profil"
        description="Feltene under brukes i booking og på den offentlige komikersiden."
        actions={
          <Chip tone={artist.status === 'approved' ? 'accent' : 'neutral'}>
            {artist.status === 'approved' ? 'Godkjent' : 'Under vurdering'}
          </Chip>
        }
      />

      <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <div className="flex flex-col gap-7">
          <ToastActionForm
            action={updateArtistProfileAction}
            encType="multipart/form-data"
            successMessage="Profilen er lagret."
          >
            <Panel title="Profilinformasjon">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Fullt navn">
                  <input name="full_name" defaultValue={artist.full_name} required className={inputClass} />
                </Field>
                <Field label="Scenenavn">
                  <input name="stage_name" defaultValue={artist.stage_name ?? ''} className={inputClass} />
                </Field>
                <Field label="Telefon">
                  <input name="phone" type="tel" defaultValue={artist.phone ?? ''} className={inputClass} />
                </Field>
                <Field label="Profilbilde">
                  <input
                    name="profile_image_file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="w-full text-[13px] text-[var(--ev-muted)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--ev-card-hover)] file:px-3.5 file:py-2 file:text-[13px] file:font-medium file:text-[var(--ev-text)]"
                  />
                </Field>
              </div>

              <Field label="Kategori">
                <input type="hidden" name="category_present" value="1" />
                <div className="flex flex-wrap gap-1.5">
                  {ARTIST_ROLE_OPTIONS.map((role) => (
                    <label key={role.value} className="cursor-pointer">
                      <input
                        type="checkbox"
                        name="category"
                        value={role.value}
                        defaultChecked={selectedCategories.has(role.value)}
                        className="peer sr-only"
                      />
                      <span className="inline-flex items-center rounded-full bg-[var(--ev-bg)] px-3.5 py-1.5 text-[13px] text-[var(--ev-muted)] ring-1 ring-inset ring-[var(--ev-line)] transition-colors hover:text-[var(--ev-text)] peer-checked:bg-[var(--ev-accent-fill)] peer-checked:font-semibold peer-checked:text-[var(--ev-accent-ink)] peer-checked:ring-[var(--ev-accent-fill)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ev-accent-fill)]">
                        {role.label}
                      </span>
                    </label>
                  ))}
                </div>
              </Field>

              <Field label="Språk">
                <select
                  name="language"
                  defaultValue={artist.language ?? 'Norsk'}
                  className={`${inputClass} appearance-none`}
                >
                  {['Norsk', 'Engelsk', 'Begge'].map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </Field>

              <Field label="Bio">
                <textarea
                  name="bio"
                  defaultValue={artist.bio ?? ''}
                  rows={7}
                  className="min-h-32 w-full rounded-xl bg-[var(--ev-bg)] px-3.5 py-3 text-[14px] leading-relaxed text-[var(--ev-text)] outline-none ring-1 ring-inset ring-[var(--ev-line)] transition-[box-shadow] placeholder:text-[var(--ev-faint)] focus:ring-2 focus:ring-[var(--ev-accent-fill)]"
                />
              </Field>

              <Field
                label="YouTube-video"
                hint="Oppdater denne lenken for å endre videoen i spilleren under."
              >
                <input
                  name="youtube"
                  type="url"
                  defaultValue={links.youtube ?? ''}
                  placeholder="https://youtube.com/watch?v=..."
                  className={inputClass}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Instagram">
                  <input name="instagram" type="url" defaultValue={links.instagram ?? ''} placeholder="https://" className={inputClass} />
                </Field>
                <Field label="TikTok">
                  <input name="tiktok" type="url" defaultValue={links.tiktok ?? ''} placeholder="https://" className={inputClass} />
                </Field>
                <Field label="Facebook">
                  <input name="facebook" type="url" defaultValue={links.facebook ?? ''} placeholder="https://" className={inputClass} />
                </Field>
                <Field label="Nettside">
                  <input name="website" type="url" defaultValue={links.website ?? ''} placeholder="https://" className={inputClass} />
                </Field>
              </div>

              <button type="submit" className={`${portalButton.primary} w-fit`}>
                Lagre profil
              </button>
            </Panel>
          </ToastActionForm>

          <YouTubePlayerCard
            url={links.youtube ?? null}
            title="Innsendt YouTube-video"
            description="Videoen du sendte inn i søknaden brukes internt av bookingteamet."
          />
        </div>

        <aside className="flex flex-col gap-7">
          {artist.profile_image_url && (
            <div
              className="relative aspect-square w-full overflow-hidden bg-[var(--ev-card-hover)]"
              style={{ borderRadius: 'var(--ev-r-card)' }}
            >
              <Image
                src={artist.profile_image_url}
                alt=""
                fill
                sizes="(max-width: 1280px) 100vw, 320px"
                unoptimized={shouldBypassImageOptimization(artist.profile_image_url)}
                className="object-cover"
              />
            </div>
          )}

          <Panel title="Bookingstatus" description="Avgjør om profilen kan matches automatisk.">
            <div className="flex flex-col divide-y divide-[var(--ev-line)]">
              <DataRow
                label="Status"
                value={artist.status === 'approved' ? 'Godkjent' : 'Under vurdering'}
              />
              <DataRow
                label="Kan bookes"
                value={artist.status === 'approved' && (artist.admin_score ?? 0) >= 6 ? 'Ja' : 'Ikke ennå'}
              />
            </div>
          </Panel>
        </aside>
      </div>
    </>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-2">
      <span className="text-[13px] font-medium">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-[var(--ev-faint)]">{hint}</span>}
    </label>
  )
}
