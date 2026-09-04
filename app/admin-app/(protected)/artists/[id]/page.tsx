import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Check, ChevronLeft, Mail, MapPin, Phone } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { AdminHeader } from '@/components/admin/admin-header'
import { ToastActionForm } from '@/components/toast-action-form'
import { EditableArtistProfile } from '@/components/admin/editable-artist-profile'
import { ArtistEnergyBadge, ArtistStatusBadge, FlaggedBadge } from '@/components/admin/artist-badges'
import { YouTubePlayerCard } from '@/components/youtube-player-card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ARTIST_ROLE_OPTIONS, normalizeArtistRoleList } from '@/lib/artist-roles'
import { READINESS_BLOCKER_LABELS, artistReadinessBlockers } from '@/lib/artist-readiness'
import { connectArtistAction, disconnectArtistAction } from '../../discover/actions'
import { approveArtistAction, rejectArtistAction, saveArtistAdminReview } from './actions'

/**
 * Komikerprofilen i klubbadmin.
 *
 * Siden har to jobber, og de er skilt: venstre side er komikerens egne
 * opplysninger, høyre side er klubbens vurdering av hen. Toppkortet svarer på
 * det man kom hit for å se — hvem er dette, kan hen bookes, og er hen min.
 *
 * Statusen settes ett sted. Før lå den både i et nedtrekk i skjemaet og i
 * «Approve»-knappen, som ikke gjorde det samme: godkjenning sender e-posten
 * med portalenken, nedtrekket gjorde det ikke.
 */

const SELECT_CLASS =
  'h-9 w-full rounded-4xl border border-input bg-input/30 px-3.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

export default async function ArtistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = createAdminClient()

  const { data: artist } = await db.from('artists').select('*').eq('id', id).single()
  if (!artist) notFound()

  const clubId = await getDefaultClubIdForAdmin()
  const { data: connection } = await db
    .from('club_artists')
    .select('artist_id')
    .eq('club_id', clubId)
    .eq('artist_id', artist.id)
    .maybeSingle()

  const inClub = Boolean(connection)
  const blockers = artistReadinessBlockers(artist)
  const normalizedCategories = normalizeArtistRoleList(artist.category ?? [])
  const name = artist.stage_name?.trim() || artist.full_name
  const place = [artist.city, artist.country].filter(Boolean).join(', ')

  return (
    <div>
      <AdminHeader title={artist.full_name} />

      <div className="flex max-w-6xl flex-col gap-6 p-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit text-muted-foreground">
          <Link href="/admin-app/artists">
            <ChevronLeft data-icon="inline-start" />
            Comedians
          </Link>
        </Button>

        {/* ── Hvem er dette, og hvor står hen ──────────────── */}
        <Card size="sm">
          <CardContent className="flex flex-wrap items-center gap-5">
            <Avatar className="size-20">
              {artist.profile_image_url && <AvatarImage src={artist.profile_image_url} alt="" />}
              <AvatarFallback className="text-xl font-semibold">
                {name.trim().charAt(0).toUpperCase() || '?'}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <h2 className="truncate text-2xl font-bold tracking-tight">{name}</h2>
              {artist.stage_name && (
                <p className="truncate text-sm text-muted-foreground">{artist.full_name}</p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Mail className="size-3.5" />
                  {artist.email}
                </span>
                {artist.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="size-3.5" />
                    {artist.phone}
                  </span>
                )}
                {place && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="size-3.5" />
                    {place}
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <ArtistStatusBadge status={artist.status} />
                {artist.admin_energy_level && <ArtistEnergyBadge level={artist.admin_energy_level} />}
                {artist.is_flagged && <FlaggedBadge />}
              </div>
            </div>

            {/* Koblingen til klubben — det man som regel kom hit for å gjøre. */}
            {inClub ? (
              <ToastActionForm action={disconnectArtistAction} successMessage={`${name} removed from your club.`}>
                <input type="hidden" name="artist_id" value={artist.id} />
                <Button type="submit" variant="secondary">
                  <Check data-icon="inline-start" />
                  In your club
                </Button>
              </ToastActionForm>
            ) : (
              <ToastActionForm action={connectArtistAction} successMessage={`${name} added to your club.`}>
                <input type="hidden" name="artist_id" value={artist.id} />
                <Button type="submit">Add to my club</Button>
              </ToastActionForm>
            )}
          </CardContent>

          {/* Kan hen bookes? Samme svar som «Not ready» i lista. */}
          <CardContent>
            {blockers.length === 0 ? (
              <p className="rounded-2xl bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                Ready for booking — matched automatically when a show needs this role.
              </p>
            ) : (
              <p className="rounded-2xl bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                Not bookable yet: {blockers.map((blocker) => READINESS_BLOCKER_LABELS[blocker]).join(' · ')}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* ── Komikerens egne opplysninger ───────────────── */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            <EditableArtistProfile artist={artist} />

            <YouTubePlayerCard
              url={artist.social_links?.youtube ?? null}
              title="Submitted YouTube video"
              description="The video the comedian sent in with their application."
            />
          </div>

          {/* ── Klubbens vurdering ─────────────────────────── */}
          <div className="flex flex-col gap-6">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Decision</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {artist.status === 'pending_review' ? (
                  <>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Approving emails the comedian their portal link, so they can set the dates they
                      are available.
                    </p>
                    <div className="flex gap-2">
                      <ToastActionForm
                        action={approveArtistAction}
                        successMessage="Comedian approved."
                        className="flex-1"
                      >
                        <input type="hidden" name="artist_id" value={artist.id} />
                        <input
                          type="hidden"
                          name="admin_energy_level"
                          value={artist.admin_energy_level ?? 'uncertain'}
                        />
                        <Button type="submit" className="w-full">
                          Approve
                        </Button>
                      </ToastActionForm>
                      <ToastActionForm
                        action={rejectArtistAction}
                        successMessage="Comedian rejected."
                        className="flex-1"
                      >
                        <input type="hidden" name="artist_id" value={artist.id} />
                        <Button type="submit" variant="destructive" className="w-full">
                          Reject
                        </Button>
                      </ToastActionForm>
                    </div>
                  </>
                ) : (
                  <ToastActionForm action={saveArtistAdminReview} successMessage="Status updated." className="flex flex-col gap-2">
                    <input type="hidden" name="artist_id" value={artist.id} />
                    {/* Skjemaet skriver bare feltene det sender — se
                        `saveArtistAdminReview`. Her er det status. */}
                    <Label htmlFor="artist-status">Status</Label>
                    <select id="artist-status" name="status" defaultValue={artist.status} className={SELECT_CLASS}>
                      <option value="pending_review">Pending review</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                      <option value="inactive">Inactive</option>
                    </select>
                    <Button type="submit" variant="outline" size="sm" className="w-fit">
                      Update status
                    </Button>
                  </ToastActionForm>
                )}
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>Booking profile</CardTitle>
              </CardHeader>
              <CardContent>
                <ToastActionForm
                  action={saveArtistAdminReview}
                  className="flex flex-col gap-5"
                  successMessage="Booking profile saved."
                >
                  <input type="hidden" name="artist_id" value={artist.id} />
                  {/* Skiller «ingen roller valgt» fra «rollene ble ikke sendt». */}
                  <input type="hidden" name="category_present" value="1" />

                  <ChipGroup
                    label="Gender"
                    name="gender"
                    current={artist.gender ?? ''}
                    chips={[
                      { value: 'woman', label: 'Woman' },
                      { value: 'man', label: 'Man' },
                      { value: 'non_binary', label: 'Non-binary' },
                      { value: 'prefer_not_to_say', label: 'Prefer not to say' },
                    ]}
                  />

                  <ChipGroup
                    label="Energy level"
                    name="admin_energy_level"
                    current={artist.admin_energy_level ?? ''}
                    chips={[
                      { value: 'high', label: 'High' },
                      { value: 'low', label: 'Low' },
                    ]}
                  />

                  <div className="flex flex-col gap-2">
                    <Label>Roles</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {ARTIST_ROLE_OPTIONS.map((role) => (
                        <label key={role.value} className="cursor-pointer">
                          <input
                            type="checkbox"
                            name="category"
                            value={role.value}
                            defaultChecked={normalizedCategories.includes(role.value)}
                            className="peer sr-only"
                          />
                          <span className="inline-flex select-none items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground">
                            {role.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="admin-notes">Internal notes</Label>
                    <textarea
                      id="admin-notes"
                      name="admin_notes"
                      defaultValue={artist.admin_notes ?? ''}
                      rows={3}
                      placeholder="Only the club sees this."
                      className="w-full resize-none rounded-2xl border border-input bg-input/30 px-3.5 py-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    />
                  </div>

                  <Button type="submit" className="w-full">
                    Save
                  </Button>
                </ToastActionForm>
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>Flag</CardTitle>
              </CardHeader>
              <CardContent>
                <ToastActionForm
                  action={saveArtistAdminReview}
                  className="flex flex-col gap-3"
                  successMessage={artist.is_flagged ? 'Flag updated.' : 'Comedian flagged.'}
                >
                  <input type="hidden" name="artist_id" value={artist.id} />

                  <p className="text-xs leading-relaxed text-muted-foreground">
                    A flagged comedian stays in the lists, but is skipped by automatic booking.
                  </p>

                  <ChipGroup
                    label="Flagged"
                    name="is_flagged"
                    current={artist.is_flagged ? 'true' : 'false'}
                    chips={[
                      { value: 'false', label: 'No' },
                      { value: 'true', label: 'Flagged' },
                    ]}
                  />

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="flag-reason">Reason</Label>
                    <input
                      id="flag-reason"
                      name="flag_reason"
                      defaultValue={artist.flag_reason ?? ''}
                      placeholder="Why was this comedian flagged?"
                      className={SELECT_CLASS}
                    />
                  </div>

                  <Button type="submit" variant="outline" size="sm" className="w-fit">
                    Save flag
                  </Button>
                </ToastActionForm>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChipGroup({
  label,
  name,
  current,
  chips,
}: {
  label: string
  name: string
  current: string
  chips: { value: string; label: string }[]
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <label key={chip.value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={chip.value}
              defaultChecked={current === chip.value}
              className="peer sr-only"
            />
            <span className="inline-flex select-none items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground">
              {chip.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
