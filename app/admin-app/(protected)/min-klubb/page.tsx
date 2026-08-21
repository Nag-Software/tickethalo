import { Building2, ImageIcon, Images, MapPin } from 'lucide-react'
import { AdminHeader } from '@/components/admin/admin-header'
import { ClubProfileForm } from '@/components/admin/club-profile-form'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { createAdminClient } from '@/lib/supabase/admin'

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-[1.5rem] border border-white/60 bg-white/80 p-4 shadow-sm backdrop-blur">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-black text-white">
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
    </div>
  )
}

export default async function MinKlubbPage() {
  const clubId = await getDefaultClubIdForAdmin()
  const db = createAdminClient()

  const [{ data: club, error: clubError }, { count: showCount }] = await Promise.all([
    db
      .from('clubs')
      .select('id, name, slug, description, logo_url, header_image_url, gallery_image_urls, location_name, address_line, city')
      .eq('id', clubId)
      .single(),
    db
      .from('shows')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', clubId),
  ])

  if (clubError || !club) {
    throw new Error('Fant ikke klubbprofilen.')
  }

  return (
    <div>
      <AdminHeader title="Min klubb" description="Branding, bilder og klubbinfo for admin-appen og offentlig profil." />
      <div className="space-y-6 p-6">
        <section className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-[radial-gradient(circle_at_top_left,_rgba(255,224,178,0.65),_transparent_28%),linear-gradient(135deg,_#fffdf7,_#fff_42%,_#f7f7f5)] p-6 shadow-sm">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_460px] lg:items-end">
            <div className="space-y-4 text-foreground">
              <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
                <Building2 className="h-3.5 w-3.5" />
                Klubbprofil
              </div>
              <div>
                <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">{club.name}</h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
                  Hold klubbens uttrykk oppdatert med logo, header, galleri og teksten som setter stemningen.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {club.city ? <span className="rounded-full border border-black/10 bg-white/75 px-3 py-1.5 backdrop-blur">{club.city}</span> : null}
                {club.location_name ? <span className="rounded-full border border-black/10 bg-white/75 px-3 py-1.5 backdrop-blur">{club.location_name}</span> : null}
                <span className="rounded-full border border-black/10 bg-white/75 px-3 py-1.5 backdrop-blur">Slug: {club.slug}</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <StatCard label="Shows" value={String(showCount ?? 0)} icon={Building2} />
                <StatCard label="Galleri" value={`${club.gallery_image_urls.length} bilder`} icon={Images} />
                <StatCard label="Logo" value={club.logo_url ? 'Klar' : 'Mangler'} icon={ImageIcon} />
                <StatCard label="Lokasjon" value={club.address_line || club.city || 'Legg til'} icon={MapPin} />
              </div>
            </div>
          </div>
        </section>

        <ClubProfileForm club={club} />
      </div>
    </div>
  )
}