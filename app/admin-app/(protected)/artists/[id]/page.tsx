import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { ToastActionForm } from '@/components/toast-action-form'
import { EditableArtistProfile } from '@/components/admin/editable-artist-profile'
import { YouTubePlayerCard } from '@/components/youtube-player-card'
import { ARTIST_ROLE_OPTIONS, normalizeArtistRoleList } from '@/lib/artist-roles'
import {
  saveArtistAdminReview,
  approveArtistAction,
  rejectArtistAction,
  deleteArtistAction,
} from './actions'
import { DeleteButton } from '@/components/admin/delete-button'

export default async function ArtistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = createAdminClient()

  const { data: artist } = await db.from('artists').select('*').eq('id', id).single()

  if (!artist) notFound()

  const scoreOptions = Array.from({ length: 10 }, (_, i) => i + 1)
  const normalizedCategories = normalizeArtistRoleList(artist.category ?? [])

  return (
    <div>
      <AdminHeader
        title={artist.full_name}
        description={artist.stage_name ?? artist.email}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin-app/artists" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              ← Back
            </Link>
            <DeleteButton
              action={deleteArtistAction}
              id={artist.id}
              idField="artist_id"
              confirmMessage={`Delete the comedian "${artist.full_name}"? This cannot be undone.`}
            />
          </div>
        }
      />

      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: Profile ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Profile card — inline editable */}
          <EditableArtistProfile artist={artist} />

          <YouTubePlayerCard
            url={artist.social_links?.youtube ?? null}
            title="Submitted YouTube video"
            description="The video the comedian sent in with their application."
          />
        </div>

        {/* ── Right: Admin review form ── */}
        <div className="space-y-4">
          <section className="rounded-xl border bg-card p-5 space-y-5">
            <h2 className="font-semibold text-sm">Comedian review</h2>

            <ToastActionForm action={saveArtistAdminReview} className="space-y-5" successMessage="The review has been saved.">
              <input type="hidden" name="artist_id" value={artist.id} />

              {/* Gender */}
              <AdminChipGroup
                label="Gender"
                name="gender"
                current={artist.gender ?? ''}
                chips={[
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                ]}
              />

              {/* Energy level */}
              <AdminChipGroup
                label="Energy level"
                name="admin_energy_level"
                current={artist.admin_energy_level ?? ''}
                chips={[
                  { value: 'high', label: 'High' },
                  { value: 'low', label: 'Low' },
                ]}
              />

              {/* Score */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Score</p>
                <div className="flex flex-wrap gap-1.5">
                  {scoreOptions.map((n) => (
                    <label key={n} className="cursor-pointer">
                      <input
                        type="radio"
                        name="admin_score"
                        value={n}
                        defaultChecked={artist.admin_score === n}
                        className="sr-only peer"
                      />
                      <span className="flex h-8 w-8 items-center justify-center rounded-md border text-xs font-semibold transition-colors peer-checked:bg-primary peer-checked:text-primary-foreground peer-checked:border-primary hover:bg-muted select-none">
                        {n}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Categories — multi-select */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Categories</p>
                <div className="flex flex-wrap gap-1.5">
                  {ARTIST_ROLE_OPTIONS.map((chip) => (
                    <label key={chip.value} className="cursor-pointer">
                      <input
                        type="checkbox"
                        name="category"
                        value={chip.value}
                        defaultChecked={normalizedCategories.includes(chip.value)}
                        className="sr-only peer"
                      />
                      <span className="inline-flex items-center px-3 py-1 rounded-full border text-xs font-medium transition-colors select-none peer-checked:bg-primary peer-checked:text-primary-foreground peer-checked:border-primary hover:bg-muted">
                        {chip.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Status */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <select name="status" defaultValue={artist.status}
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="pending_review">Pending review</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="inactive">Inactive</option>
                  <option value="flagged">Flagged</option>
                </select>
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                <textarea
                  name="admin_notes"
                  defaultValue={artist.admin_notes ?? ''}
                  rows={3}
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Internal notes…"
                />
              </div>

              {/* Flag */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Flagged</label>
                <select name="is_flagged" defaultValue={artist.is_flagged ? 'true' : 'false'}
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="false">No</option>
                  <option value="true">Yes — flagged</option>
                </select>
              </div>

              {artist.is_flagged && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Reason for flagging</label>
                  <input
                    name="flag_reason"
                    defaultValue={artist.flag_reason ?? ''}
                    className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              <button type="submit"
                className="w-full bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors">
                Save
              </button>
            </ToastActionForm>

            {/* Quick actions */}
            <div className="pt-1 border-t">
              {artist.status === 'pending_review' ? (
                <div className="flex gap-2">
                  <ToastActionForm action={approveArtistAction} className="flex-1">
                    <input type="hidden" name="artist_id" value={artist.id} />
                    <input type="hidden" name="admin_score" value={artist.admin_score ?? 7} />
                    <button type="submit"
                      className="w-full text-xs px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
                      ✓ Approve
                    </button>
                  </ToastActionForm>
                  <ToastActionForm action={rejectArtistAction} className="flex-1">
                    <input type="hidden" name="artist_id" value={artist.id} />
                    <button type="submit"
                      className="w-full text-xs px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors">
                      ✕ Reject
                    </button>
                  </ToastActionForm>
                </div>
              ) : artist.status === 'approved' ? (
                <p className="text-xs text-emerald-600 font-medium">✓ Approved – final decision</p>
              ) : artist.status === 'rejected' ? (
                <p className="text-xs text-destructive font-medium">✕ Rejected – final decision</p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function AdminChipGroup({ label, name, current, chips }: {
  label: string
  name: string
  current: string  // single-select (radio)
  chips: { value: string; label: string }[]
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {chips.map(chip => (
          <label key={chip.value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={chip.value}
              defaultChecked={current === chip.value}
              className="sr-only peer"
            />
            <span className="inline-flex items-center px-3 py-1 rounded-full border text-xs font-medium transition-colors select-none peer-checked:bg-primary peer-checked:text-primary-foreground peer-checked:border-primary hover:bg-muted">
              {chip.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
