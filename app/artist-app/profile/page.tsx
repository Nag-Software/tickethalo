import Image from 'next/image'
import { ToastActionForm } from '@/components/toast-action-form'
import { YouTubePlayerCard } from '@/components/youtube-player-card'
import { updateArtistProfileAction } from '../actions'
import { getCurrentArtist } from '@/lib/artist-portal'
import { formatArtistRoleList } from '@/lib/artist-roles'
import { isArtistBookable } from '@/lib/artist-readiness'
import { LocationLanguageFields } from '@/components/artist/location-language-fields'
import { shouldBypassImageOptimization } from '@/lib/utils'
import { Chip, DataRow, PageHeader, Panel, portalButton } from '@/components/artist/portal-ui'

const inputClass =
  'h-10 w-full rounded-xl bg-[var(--ev-bg)] px-3.5 text-[14px] text-[var(--ev-text)] outline-none ring-1 ring-inset ring-[var(--ev-line)] transition-[box-shadow] placeholder:text-[var(--ev-faint)] focus:ring-2 focus:ring-[var(--ev-accent-fill)]'

export default async function ArtistProfilePage() {
  const { artist } = await getCurrentArtist()
  const links = artist.social_links ?? {}
  const roleSummary = formatArtistRoleList(artist.category).join(', ')

  return (
    <>
      <PageHeader
        title="Profile"
        description="The fields below are used for booking and on the public comedian page."
        actions={
          <Chip tone={artist.status === 'approved' ? 'accent' : 'neutral'}>
            {artist.status === 'approved' ? 'Approved' : 'Under review'}
          </Chip>
        }
      />

      <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <div className="flex flex-col gap-7">
          <ToastActionForm
            action={updateArtistProfileAction}
            encType="multipart/form-data"
            successMessage="Profile saved."
          >
            <Panel title="Profile Information">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full Name">
                  <input name="full_name" defaultValue={artist.full_name} required className={inputClass} />
                </Field>
                <Field label="Stage Name">
                  <input name="stage_name" defaultValue={artist.stage_name ?? ''} className={inputClass} />
                </Field>
                <Field label="Phone">
                  <input name="phone" type="tel" defaultValue={artist.phone ?? ''} className={inputClass} />
                </Field>
                <Field label="Account number" hint="Where your fee is paid after a show.">
                  <input
                    name="bank_account_number"
                    defaultValue={artist.bank_account_number ?? ''}
                    inputMode="numeric"
                    placeholder="1234.56.78901"
                    className={inputClass}
                  />
                </Field>
                <Field label="Profile Picture">
                  <input
                    name="profile_image_file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="w-full text-[13px] text-[var(--ev-muted)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--ev-card-hover)] file:px-3.5 file:py-2 file:text-[13px] file:font-medium file:text-[var(--ev-text)]"
                  />
                </Field>
              </div>

              <LocationLanguageFields
                initialCity={artist.city}
                initialCountry={artist.country}
                initialLanguages={artist.languages}
              />

              <Field label="Bio">
                <textarea
                  name="bio"
                  defaultValue={artist.bio ?? ''}
                  rows={7}
                  className="min-h-32 w-full rounded-xl bg-[var(--ev-bg)] px-3.5 py-3 text-[14px] leading-relaxed text-[var(--ev-text)] outline-none ring-1 ring-inset ring-[var(--ev-line)] transition-[box-shadow] placeholder:text-[var(--ev-faint)] focus:ring-2 focus:ring-[var(--ev-accent-fill)]"
                />
              </Field>

              <Field
                label="YouTube Video"
                hint="Update this link to change the video in the player below."
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
                <Field label="Website">
                  <input name="website" type="url" defaultValue={links.website ?? ''} placeholder="https://" className={inputClass} />
                </Field>
              </div>

              <button type="submit" className={`${portalButton.primary} w-fit`}>
                Save Profile
              </button>
            </Panel>
          </ToastActionForm>

          <YouTubePlayerCard
            url={links.youtube ?? null}
            title="Submitted YouTube Video"
            description="The video you submitted in the application is used internally by the booking team."
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

          <Panel title="Booking Status" description="Determine if the profile can be matched automatically.">
            <div className="flex flex-col divide-y divide-[var(--ev-line)]">
              <DataRow
                label="Status"
                value={artist.status === 'approved' ? 'Approved' : 'Under review'}
              />
              <DataRow
                label="Can be booked"
                value={isArtistBookable(artist) ? 'Yes' : 'Not yet'}
              />
              {/* Rollen er lesbar, men ikke redigerbar: den settes av klubben. */}
              <DataRow
                label="Role"
                value={roleSummary || <span className="text-[var(--ev-faint)]">Set by the club</span>}
              />
            </div>
            <p className="text-[12.5px] leading-relaxed text-[var(--ev-muted)]">
              Your role is assigned by the booking team based on your shows.
            </p>
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
