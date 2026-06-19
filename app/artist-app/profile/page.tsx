import Image from 'next/image'
import Link from 'next/link'
import {
  ArtistBadge,
  ArtistPage,
  ArtistPageHeader,
  artistPrimaryButtonClass,
} from '@/components/artist/artist-ui'
import { Input } from '@/components/ui/input'
import { ToastActionForm } from '@/components/toast-action-form'
import { YouTubePlayerCard } from '@/components/youtube-player-card'
import { updateArtistProfileAction } from '../actions'
import { getCurrentArtist, isArtistBookable, isArtistGloballyApproved } from '@/lib/artist-portal'
import { ARTIST_ROLE_OPTIONS, normalizeArtistRoleList } from '@/lib/artist-roles'
import { shouldBypassImageOptimization } from '@/lib/utils'

export default async function ArtistProfilePage() {
  const { artist } = await getCurrentArtist()
  const links = artist.social_links ?? {}
  const selectedCategories = new Set(normalizeArtistRoleList(artist.category))
  const isApproved = isArtistBookable(artist)

  return (
    <ArtistPage>
      <ArtistPageHeader
        title="Profil"
        description="Informasjonen bookingteamet bruker når de matcher deg mot show."
        action={
          <Link href="/artist-app/available-dates" className="text-sm font-medium underline underline-offset-4 hover:text-primary">
            Tilgjengelighet
          </Link>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-6">
          <ToastActionForm
            action={updateArtistProfileAction}
            encType="multipart/form-data"
            className="grid gap-6 rounded-2xl border border-border p-5 md:p-6"
            successMessage="Profilen er lagret."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Fullt navn"><Input name="full_name" defaultValue={artist.full_name} required /></Field>
              <Field label="Scenenavn"><Input name="stage_name" defaultValue={artist.stage_name ?? ''} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Telefon"><Input name="phone" type="tel" defaultValue={artist.phone ?? ''} /></Field>
              <Field label="E-post"><Input value={artist.email} readOnly className="bg-zinc-50" /></Field>
            </div>
            <Field label="Profilbilde">
              <Input name="profile_image_file" type="file" accept="image/png,image/jpeg,image/webp" />
            </Field>
            <Field label="Kategori">
              <div className="space-y-3">
                <input type="hidden" name="category_present" value="1" />
                <div className="flex flex-wrap gap-2">
                  {ARTIST_ROLE_OPTIONS.map((role) => (
                    <label key={role.value} className="cursor-pointer">
                      <input
                        type="checkbox"
                        name="category"
                        value={role.value}
                        defaultChecked={selectedCategories.has(role.value)}
                        className="peer sr-only"
                      />
                      <span className="inline-flex items-center rounded-lg border border-input px-3 py-1.5 text-sm transition peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground hover:bg-zinc-50">
                        {role.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Språk">
                <Select name="language" defaultValue={artist.language ?? 'Norsk'} options={['Norsk', 'Engelsk', 'Begge']} />
              </Field>
              <Field label="YouTube-video">
                <Input name="youtube" type="url" defaultValue={links.youtube ?? ''} placeholder="https://youtube.com/watch?v=..." />
              </Field>
            </div>
            <Field label="Bio">
              <textarea
                name="bio"
                defaultValue={artist.bio ?? ''}
                rows={5}
                className="min-h-28 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm outline-none focus:border-ring"
                placeholder="Kort om deg og scenestil."
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Instagram"><Input name="instagram" type="url" defaultValue={links.instagram ?? ''} placeholder="https://" /></Field>
              <Field label="TikTok"><Input name="tiktok" type="url" defaultValue={links.tiktok ?? ''} placeholder="https://" /></Field>
              <Field label="Facebook"><Input name="facebook" type="url" defaultValue={links.facebook ?? ''} placeholder="https://" /></Field>
              <Field label="Nettside"><Input name="website" type="url" defaultValue={links.website ?? ''} placeholder="https://" /></Field>
            </div>
            <button type="submit" className={artistPrimaryButtonClass}>Lagre profil</button>
          </ToastActionForm>

          <YouTubePlayerCard
            url={links.youtube ?? null}
            title="YouTube-video"
            description="Videoen brukes internt av bookingteamet."
          />
        </div>

        <aside className="space-y-4">
          {artist.profile_image_url && (
            <div className="relative aspect-square overflow-hidden rounded-2xl border border-border">
              <Image
                src={artist.profile_image_url}
                alt={artist.stage_name ?? artist.full_name}
                fill
                unoptimized={shouldBypassImageOptimization(artist.profile_image_url)}
                className="object-cover"
              />
            </div>
          )}
          <div className="rounded-2xl border border-border p-4 text-sm">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Bookingstatus</p>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <ArtistBadge variant={isArtistGloballyApproved(artist) || isApproved ? 'accent' : 'muted'}>
                  {isApproved ? 'Godkjent' : 'Vurderes'}
                </ArtistBadge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Kan bookes</span>
                <span className="font-medium">
                  {isArtistBookable(artist) ? 'Ja' : 'Ikke ennå'}
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </ArtistPage>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-2 text-sm"><span className="font-medium">{label}</span>{children}</label>
}

function Select({ name, defaultValue, options }: { name: string; defaultValue: string; options: string[] }) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring"
    >
      {options.map((option) => <option key={option}>{option}</option>)}
    </select>
  )
}
