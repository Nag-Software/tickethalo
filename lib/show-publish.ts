import { createAdminClient } from '@/lib/supabase/admin'
import { generateShowPoster } from '@/lib/poster/generate'
import { resolvePalette } from '@/lib/marketing/palette'
import { getClubForShow, isClubPayoutReady, missingReadinessLabels } from '@/lib/stripe-connect'
import { showVenue } from '@/lib/show-venue'

/*
 * Publiseringen ligger her og ikke i `lib/actions/booking.ts` med vilje: den
 * filen er `'use server'`, og alt den eksporterer kan kalles fra nettleseren.
 * Publisering skal bare kunne nås gjennom `publishShowAction`, som sjekker at
 * den som trykker hører til klubben.
 */

type LineupRequirement = { id: string; role_name: string; quantity: number }

/**
 * Første plass som ikke er fylt, eller null når lineupen er full.
 *
 * Databasen holder den samme grensen ved publisering (migrasjon 053), så
 * sjekken her er den som gir en lesbar beskjed, ikke den som er load-bearing.
 */
export async function firstOpenRequirement(
  admin: ReturnType<typeof createAdminClient>,
  requirements: LineupRequirement[],
) {
  for (const req of requirements) {
    const { count } = await admin
      .from('confirmed_spots')
      .select('*', { count: 'exact', head: true })
      .eq('show_requirement_id', req.id)
      .in('status', ['confirmed', 'completed', 'paid'])

    if ((count ?? 0) < req.quantity) return { ...req, filled: count ?? 0 }
  }
  return null
}

/**
 * Publiserer showet. Kalles bare fra klubbens egen Publiser-knapp.
 *
 * Det finnes ingen vei til `published` med ledige plasser. Publikum kjøper
 * billett til en kveld med navn på, og navn som dukker opp etterpå rekker
 * verken plakat eller markedsføring. Vil klubben kjøre med færre komikere,
 * sletter bookeren plassen — da er lineupen full.
 */
export async function publishShow(showId: string) {
  const admin = createAdminClient()

  const { data: requirements } = await admin
    .from('show_requirements')
    .select('id, role_name, quantity')
    .eq('show_id', showId)

  if (!requirements?.length) return { published: false, reason: 'no_requirements' as const }

  const open = await firstOpenRequirement(admin, requirements)
  if (open) {
    return {
      published: false,
      reason: 'requirements_not_filled' as const,
      message: `Krav "${open.role_name}" er ikke fylt (${open.filled}/${open.quantity})`,
    }
  }

  const { data: show } = await admin
    .from('shows')
    .select('title, slug, date, start_time, venue_name, venue_address, poster_url, published_at, selected_marketing_design_id, auto_poster_enabled, marketing_palette, poster_background_url, poster_background_path, club_id, status')
    .eq('id', showId)
    .single()

  if (!show) return { published: false, reason: 'show_not_found' as const }

  if (show.status === 'published') {
    return { published: true, publishedNow: false, posterUrl: show.poster_url ?? null, publishedAt: show.published_at }
  }

  // Er klubbens Connect-konto ikke ferdig, ville billettsalget åpnet uten en
  // selger å ta imot pengene på vegne av.
  const club = await getClubForShow(showId)
  if (!isClubPayoutReady(club)) {
    return {
      published: false,
      reason: 'club_not_payable' as const,
      message: `Klubben mangler: ${missingReadinessLabels(club).join(', ')}`,
    }
  }

  const { data: spots } = await admin
    .from('confirmed_spots')
    .select('artist_id, show_requirement_id')
    .eq('show_id', showId)
    .in('status', ['confirmed', 'completed', 'paid'])

  const artistIds = [...new Set((spots ?? []).map((spot) => spot.artist_id))]
  const { data: artistRows } = artistIds.length > 0
    ? await admin.from('artists').select('id, full_name, stage_name, profile_image_url').in('id', artistIds)
    : { data: [] as Array<{ id: string; full_name: string; stage_name: string | null; profile_image_url: string | null }> }
  const artistById = new Map((artistRows ?? []).map((artist) => [artist.id, artist]))
  const requirementById = new Map((requirements ?? []).map((requirement) => [requirement.id, requirement.role_name]))

  let posterUrl = show.poster_url ?? null

  // AI-plakaten lages ikke av seg selv. De fleste klubber har sin egen
  // plakat, og en generert plakat som overrasker dem på publiseringstidspunktet
  // er verre enn ingen plakat. `auto_poster_enabled` er av som standard, og
  // klubben skrur den på per show i markedsføringsfanen om den vil ha den.
  if (!posterUrl && show.auto_poster_enabled) {
    const { data: clubBrand } = show.club_id
      ? await admin.from('clubs').select('brand_color').eq('id', show.club_id).maybeSingle()
      : { data: null }
    const clubBrandColor = clubBrand?.brand_color ?? null

    // Malen kan ligge i klubbens bibliotek og ikke på showet, så oppslaget går
    // på id alene — tilhørigheten ble sjekket da malen ble valgt.
    const { data: posterDesign } = show.selected_marketing_design_id
      ? await admin
        .from('show_marketing_designs')
        .select('id, label, file_url, poster_layout, layout_status, plate_url, plate_path')
        .eq('id', show.selected_marketing_design_id)
        .maybeSingle()
      : { data: null }

    posterUrl = await generateShowPoster(showId, {
      clubId: show.club_id,
      title: show.title,
      date: show.date,
      startTime: show.start_time,
      venue: showVenue(show).line ?? '',
      artists: (spots ?? []).flatMap((spot) => {
        const artist = artistById.get(spot.artist_id)
        if (!artist) return []
        return [{
          id: artist.id,
          name: artist.stage_name ?? artist.full_name,
          imageUrl: artist.profile_image_url,
          roleName: requirementById.get(spot.show_requirement_id) ?? null,
        }]
      }),
      template: posterDesign
        ? {
          id: posterDesign.id,
          label: posterDesign.label,
          fileUrl: posterDesign.file_url,
          platePath: posterDesign.plate_path,
          layout: posterDesign.poster_layout,
          layoutStatus: posterDesign.layout_status,
          plateUrl: posterDesign.plate_url,
        }
        : null,
      palette: resolvePalette(show.marketing_palette, clubBrandColor),
      existingBackground: { url: show.poster_background_url, path: show.poster_background_path },
    })
  }

  // Et show som har vært publisert før beholder det første tidspunktet.
  const publishedAt = show.published_at ?? new Date().toISOString()
  const posterWasGenerated = Boolean(posterUrl) && posterUrl !== show.poster_url

  const { data: publishedRows, error: publishError } = await admin.from('shows').update({
    status: 'published',
    published_at: publishedAt,
    ...(posterUrl ? { poster_url: posterUrl } : {}),
    ...(posterWasGenerated ? { poster_source: 'ai' as const } : {}),
  }).eq('id', showId).in('status', ['draft', 'booking', 'fullbooked']).select('id')

  if (publishError) {
    // Vakten i databasen (053) svarer her hvis noe har endret seg mellom
    // tellingen over og oppdateringen.
    return { published: false, reason: 'publish_rejected' as const, message: publishError.message }
  }

  if (!publishedRows?.length) {
    // Statusen endret seg under oss — avlyst eller spilt. Ingenting ble
    // publisert, og da skal svaret ikke si at det ble det.
    return { published: false, reason: 'publish_rejected' as const, message: 'Showet kan ikke publiseres fra statusen det har nå.' }
  }

  // Markedsføringsoppgavene hører til publiseringen, ikke til hvilken vei
  // siste plass ble fylt. Et show bookeren fylte ved å legge komikere rett
  // inn i lineupen fikk før ingen oppgaver i det hele tatt.
  await admin.from('marketing_tasks').upsert([
    { show_id: showId, task_key: 'publish_event_page', label: 'Publiser event-side', is_completed: true },
    { show_id: showId, task_key: 'activate_ticket_sales', label: 'Aktiver billettsalg', is_completed: false },
    { show_id: showId, task_key: 'upload_poster', label: 'Plakat på plass', is_completed: Boolean(posterUrl) },
    { show_id: showId, task_key: 'create_facebook_event', label: 'Opprett Facebook-event', is_completed: false },
    { show_id: showId, task_key: 'share_facebook_groups', label: 'Del i Facebook-grupper', is_completed: false },
    { show_id: showId, task_key: 'send_calendar_partners', label: 'Send til kalenderpartnere', is_completed: false },
    { show_id: showId, task_key: 'schedule_email', label: 'Planlegg e-postkampanje', is_completed: false },
  ], { onConflict: 'show_id,task_key', ignoreDuplicates: true })

  // Fylles siste plass av et ja, har `accept_booking_offer` allerede seedet
  // de samme radene — med event-siden *ikke* publisert. Upserten over hopper
  // over eksisterende rader, så uten dette sto oppgaven «Publiser event-side»
  // igjen som ugjort på et show som nettopp ble publisert.
  await admin.from('marketing_tasks')
    .update({ is_completed: true })
    .eq('show_id', showId)
    .eq('task_key', 'publish_event_page')

  if (posterUrl) {
    await admin.from('marketing_tasks')
      .update({ is_completed: true })
      .eq('show_id', showId)
      .eq('task_key', 'upload_poster')
  }

  return { published: true, publishedNow: true, posterUrl, publishedAt }
}
