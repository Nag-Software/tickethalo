import { SetupGuideWidget } from '@/components/admin/setup-guide-widget'
import { dismissSetupGuideAction } from '@/app/admin-app/(protected)/setup-guide-actions'
import { describeSetupGuide } from '@/lib/setup-guide'
import { CLUB_CONNECT_FIELDS, type ConnectClub } from '@/lib/stripe-connect'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Henter det guiden sjekker av fra, for klubben som er valgt. Null når
 * klubben har lagt guiden bort, eller når ingen klubb er valgt.
 *
 * Tre små spørringer per sidevisning i klubbportalen. Guiden forsvinner
 * av seg selv når klubben er ferdig og trykker Done, så kostnaden er
 * begrenset til de første ukene.
 */
export async function SetupGuide({ clubId }: { clubId: string | null }) {
  if (!clubId) return null

  const db = createAdminClient()
  const [{ data: clubRow }, { count: showCount }, { count: publishedCount }] = await Promise.all([
    db.from('clubs').select(`${CLUB_CONNECT_FIELDS}, description, setup_guide_dismissed_at`).eq('id', clubId).maybeSingle(),
    db.from('shows').select('id', { count: 'exact', head: true }).eq('club_id', clubId).is('deleted_at', null).eq('is_template', false),
    db
      .from('shows')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', clubId)
      .is('deleted_at', null)
      .eq('is_template', false)
      .in('status', ['published', 'completed']),
  ])

  if (!clubRow) return null
  const club = clubRow as unknown as ConnectClub & { description: string | null; setup_guide_dismissed_at: string | null }
  if (club.setup_guide_dismissed_at) return null

  const guide = describeSetupGuide({ club, showCount: showCount ?? 0, publishedCount: publishedCount ?? 0 })

  return <SetupGuideWidget guide={guide} dismiss={dismissSetupGuideAction} />
}
