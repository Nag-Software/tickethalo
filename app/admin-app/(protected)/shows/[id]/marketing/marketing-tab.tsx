import QRCode from 'qrcode'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePalette } from '@/lib/marketing/palette'
import { loadShowMaterial } from '@/lib/marketing/show-material'
import { showEmailBody, showEmailSubject, showMaterialText } from '@/lib/marketing/copy'
import { getAuthUser, getSessionProfile } from '@/lib/session'
import { PosterArchive, type ArchivedPoster } from './poster-archive'
import { PosterStage } from './poster-stage'
import { ShowMaterialCard } from './show-material-card'
import { SendEmailCard, type CampaignSummary } from './send-email-card'
import {
  clearShowPosterAction,
  deleteMarketingDesignAction,
  uploadShowPosterAction,
  useDesignAsPosterAction,
} from './actions'

/**
 * Markedsføringsfanen på et show — tre ting (ClickUp 869fgj7fu):
 *
 *  1. Upload poster — klubbens egen plakat, og de forrige.
 *  2. Show marketing material — komikerbilder, QR-kode og tekst, og alt i én zip.
 *  3. Send e-mail about show — til klubbens e-postliste (Marketing i menyen).
 *
 * AI-plakaten er parkert, ikke slettet: AutoPosterToggle, BrandColorsCard,
 * TemplatePicker, SlotMatcher, ExportPanel og genereringsknappene i
 * PosterStage rendres ikke, men komponentene, actions og `lib/poster/*` /
 * `lib/marketing/*` ligger der til den skal tilbake. Sjekklisten
 * (ChecklistCard) er parkert på samme måte — fanen skal ha tre funksjoner.
 */

export async function MarketingTab({ showId }: { showId: string }) {
  const db = createAdminClient()

  const [{ data: show }, material] = await Promise.all([
    db
      .from('shows')
      .select('id, club_id, title, poster_url, poster_source, marketing_palette, selected_marketing_design_id')
      .eq('id', showId)
      .single(),
    loadShowMaterial(showId),
  ])

  if (!show || !material) return null

  // Malene ligger i klubbens bibliotek. Filer lastet opp på dette showet
  // hentes i samme spørring, så begge deler vises i én liste.
  const designsQuery = db
    .from('show_marketing_designs')
    .select('id, show_id, club_id, kind, file_url, source, lineup_snapshot, created_at')
    .order('created_at', { ascending: false })

  // `.or()` tar en rå filterstreng, så begge id-ene sjekkes mot UUID-formen
  // først — de kommer fra ruten og fra basen, men strengen skal ikke kunne
  // bære med seg noe annet enn en id.
  const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

  const [
    { data: club },
    { data: designs },
    { count: recipientCount },
    { data: campaignRows },
    user,
  ] = await Promise.all([
    show.club_id
      ? db.from('clubs').select('brand_color').eq('id', show.club_id).maybeSingle()
      : Promise.resolve({ data: null }),
    show.club_id && isUuid(showId) && isUuid(show.club_id)
      ? designsQuery.or(`show_id.eq.${showId},club_id.eq.${show.club_id}`)
      : designsQuery.eq('show_id', showId),
    show.club_id
      ? db.from('club_contacts').select('id', { count: 'exact', head: true }).eq('club_id', show.club_id).is('unsubscribed_at', null)
      : Promise.resolve({ count: 0 }),
    db
      .from('email_campaigns')
      .select('id, created_at, created_by, status, recipient_count, sent_count, failed_count')
      .eq('show_id', showId)
      .eq('kind', 'show_promo')
      .order('created_at', { ascending: false })
      .limit(10),
    getAuthUser(),
  ])

  const profile = user ? await getSessionProfile(user.id) : null
  const senderIds = [...new Set((campaignRows ?? []).map((row) => row.created_by).filter((id): id is string => Boolean(id)))]
  const { data: senders } = senderIds.length
    ? await db.from('profiles').select('id, full_name, email').in('id', senderIds)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string }> }
  const senderName = new Map((senders ?? []).map((sender) => [sender.id, sender.full_name?.trim() || sender.email]))

  const campaigns: CampaignSummary[] = (campaignRows ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    createdBy: row.created_by ? senderName.get(row.created_by) ?? null : null,
    status: row.status,
    recipientCount: row.recipient_count,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
  }))

  const selectedTemplate = (designs ?? [])
    .find((design) => design.kind === 'template' && design.id === show.selected_marketing_design_id) ?? null
  const palette = resolvePalette(show.marketing_palette, club?.brand_color ?? null)

  // En plakat er utdatert når lineupen den ble laget for ikke lenger er
  // lineupen showet har. Opplastede plakater har ingen kjent lineup.
  const currentLineup = new Set(material.comedians.map((comedian) => comedian.artistId))
  const archive: ArchivedPoster[] = (designs ?? [])
    .filter((design) => design.kind === 'poster' && design.show_id === showId)
    .map((design) => {
      const snapshot = (design.lineup_snapshot ?? []).map((entry) => entry.artist_id).filter((id): id is string => Boolean(id))
      const isOutdated = design.lineup_snapshot != null
        && (snapshot.length !== currentLineup.size || snapshot.some((id) => !currentLineup.has(id)))
      return {
        id: design.id,
        fileUrl: design.file_url,
        source: design.source,
        createdAt: design.created_at,
        isActive: design.file_url === show.poster_url,
        isOutdated,
      }
    })

  const qrDataUrl = await QRCode.toDataURL(material.publicUrl, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
  const materialText = showMaterialText({
    ...material.copy,
    bios: material.comedians.map((comedian) => ({ name: comedian.name, bio: comedian.bio })),
  })
  const clubName = material.club?.name ?? 'your club'

  return (
    <div className="space-y-6">
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <PosterStage
          showId={show.id}
          showTitle={show.title}
          posterUrl={show.poster_url}
          posterSource={show.poster_source}
          palette={palette}
          uploadAction={uploadShowPosterAction}
          clearAction={clearShowPosterAction}
          hasTemplate={Boolean(selectedTemplate)}
        />

        <PosterArchive
          showId={show.id}
          posters={archive}
          restoreAction={useDesignAsPosterAction}
          deleteAction={deleteMarketingDesignAction}
        />
      </div>

      <ShowMaterialCard
        comedians={material.comedians.map((comedian) => ({
          artistId: comedian.artistId,
          name: comedian.name,
          imageUrl: comedian.imageUrl,
        }))}
        qrDataUrl={qrDataUrl}
        publicUrl={material.publicUrl}
        text={materialText}
        downloadHref={`/admin-app/shows/${show.id}/marketing/material`}
      />

      <SendEmailCard
        showId={show.id}
        clubName={clubName}
        showTitle={show.title}
        posterUrl={show.poster_url}
        publicUrl={material.publicUrl}
        defaultSubject={showEmailSubject({ clubName, date: material.show.date, title: show.title })}
        defaultBody={showEmailBody(material.copy)}
        recipientCount={recipientCount ?? 0}
        isPublished={material.show.status === 'published'}
        userEmail={profile?.email ?? null}
        campaigns={campaigns}
      />
    </div>
  )
}
