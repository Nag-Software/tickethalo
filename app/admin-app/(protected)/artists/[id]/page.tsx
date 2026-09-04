import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Check, ChevronLeft, Mail, MapPin, Phone } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClubAccess, getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { EMPTY_REVIEW, clubArtistReview } from '@/lib/club-artist-profile'
import { AdminHeader } from '@/components/admin/admin-header'
import { ToastActionForm } from '@/components/toast-action-form'
import { ArtistProfileCard } from '@/components/admin/artist-profile-card'
import { ArtistEnergyBadge, ArtistStatusBadge, FlaggedBadge } from '@/components/admin/artist-badges'
import { YouTubePlayerCard } from '@/components/youtube-player-card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ARTIST_ROLE_OPTIONS, normalizeArtistRoleList } from '@/lib/artist-roles'
import { READINESS_BLOCKER_LABELS, artistReadinessBlockers } from '@/lib/artist-readiness'
import { disconnectArtistAction } from '../../discover/actions'
import { ConnectArtistButton } from '@/components/admin/connect-artist-button'
import { saveClubArtistReviewAction, updateArtistStatusAction } from './actions'

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

  // Klubbens egen vurdering. Er komikeren ikke knyttet til klubben, finnes
  // den ikke ennå — da vises et tomt utgangspunkt, og skjemaene er stengt.
  const review = (await clubArtistReview(db, clubId, artist.id)) ?? EMPTY_REVIEW
  const { isSuperadmin } = await getClubAccess()
  const blockers = artistReadinessBlockers({ status: artist.status, category: review.category })
  const normalizedCategories = normalizeArtistRoleList(review.category ?? [])
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
                {review.admin_energy_level && <ArtistEnergyBadge level={review.admin_energy_level} />}
                {review.is_flagged && <FlaggedBadge />}
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
              <ConnectArtistButton
                artistId={artist.id}
                artistName={name}
                suggestedRoles={artist.category}
              />
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
            <ArtistProfileCard artist={artist} />

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
                <CardTitle>Platform status</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Comedians are approved automatically when they sign up. This is moderation, not
                  an approval queue — suspending someone removes them from their own portal and
                  from every club&apos;s booking, so only a superadmin can change it.
                </p>

                {isSuperadmin ? (
                  <ToastActionForm action={updateArtistStatusAction} successMessage="Status updated." className="flex flex-col gap-2">
                    <input type="hidden" name="artist_id" value={artist.id} />
                    <Label htmlFor="artist-status">Status</Label>
                    <select id="artist-status" name="status" defaultValue={artist.status} className={SELECT_CLASS}>
                      <option value="approved">Approved — active on Tickethalo</option>
                      <option value="inactive">Inactive — paused, can be reinstated</option>
                      <option value="rejected">Rejected — removed from the platform</option>
                    </select>
                    <Button type="submit" variant="outline" size="sm" className="w-fit">
                      Update status
                    </Button>
                  </ToastActionForm>
                ) : (
                  <p className="rounded-2xl bg-muted px-4 py-2.5 text-xs text-muted-foreground">
                    Done with this comedian? Remove them from your club, or flag them below. Both
                    stay with your club.
                  </p>
                )}
              </CardContent>
            </Card>

            {inClub ? (
              <>
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Your club&apos;s booking profile</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
                    Roles, energy, notes and the flag are yours alone. Another club booking the same
                    comedian keeps its own.
                  </p>
                  <ToastActionForm
                    action={saveClubArtistReviewAction}
                    className="flex flex-col gap-5"
                    successMessage="Booking profile saved."
                  >
                    <input type="hidden" name="artist_id" value={artist.id} />
                    {/* Skiller «ingen roller valgt» fra «rollene ble ikke sendt». */}
                    <input type="hidden" name="category_present" value="1" />

                    <ChipGroup
                      label="Energy level"
                      name="admin_energy_level"
                      current={review.admin_energy_level ?? ''}
                      chips={[
                        { value: 'high', label: 'High' },
                        { value: 'low', label: 'Low' },
                      ]}
                    />

                    <div className="flex flex-col gap-2">
                      <Label>Book them as</Label>
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
                        defaultValue={review.admin_notes ?? ''}
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
                    action={saveClubArtistReviewAction}
                    className="flex flex-col gap-3"
                    successMessage={review.is_flagged ? 'Flag updated.' : 'Comedian flagged.'}
                  >
                    <input type="hidden" name="artist_id" value={artist.id} />

                    <p className="text-xs leading-relaxed text-muted-foreground">
                      A flagged comedian stays in the lists, but is skipped by automatic booking.
                    </p>

                    <ChipGroup
                      label="Flagged"
                      name="is_flagged"
                      current={review.is_flagged ? 'true' : 'false'}
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
                        defaultValue={review.flag_reason ?? ''}
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
              </>
            ) : (
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Your club&apos;s booking profile</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Roles, energy, notes and flags belong to the club that books the comedian. Add
                    them to your club to set yours.
                  </p>
                </CardContent>
              </Card>
            )}
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
