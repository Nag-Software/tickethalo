import { createAdminClient } from '@/lib/supabase/admin'
import { loadLineupContext, loadLineupHistory, reminderRenderer } from '@/lib/lineup-messages'
import { pinnedInfo } from '@/lib/lineup-communication'
import { changeHeadline, changeLines, suggestedChangeMessage } from '@/lib/lineup-changes'
import { REMINDER_DAYS_BEFORE, reminderEnabled, reminderPlan } from '@/lib/lineup-reminders'
import { formatWhatsAppNumber, lineupGroupName, waMeLink } from '@/lib/whatsapp'
import { showDateLabel } from '@/lib/email/templates'
import { CommunicationPanel, type CommunicationData } from './communication-panel'

/**
 * Communication-fanen (ClickUp 869f4baqd).
 *
 *  1. Endringsdyttet — når dato, tid eller sted er flyttet etter booking.
 *  2. Message line-up — e-post til alle i lineupen, og i portalen deres.
 *  3. Påminnelsen 5 dager før, på eller av.
 *  4. Gruppechatten i WhatsApp, laget for hånd med vår hjelp.
 *  5. Historikken.
 *
 * Alt leses her; panelet er klienten som sender.
 */
export async function CommunicationTab({ showId }: { showId: string }) {
  const db = createAdminClient()
  const [context, history] = await Promise.all([loadLineupContext(db, showId), loadLineupHistory(db, showId)])
  if (!context) return null

  const { show, club, details } = context
  const notice = show.lineup_change_notice
  const confirmedSpots = context.spots.filter((spot) => spot.status === 'confirmed')
  const plan = reminderPlan(show, club.lineup_reminder_default)

  // Forhåndsvisningen er e-posten en i lineupen får — helst ikke verten,
  // som ser «You are hosting» der de andre ser vertens kontakt. Uten lineup
  // en tenkt komiker, så klubben ser teksten før noen har sagt ja.
  const sample = context.recipients.find((recipient) => recipient.artistId !== details.host?.artistId)
    ?? context.recipients[0]
    ?? { artistId: '', email: '', name: 'Alex', whatsapp: null }
  const preview = reminderRenderer(context, REMINDER_DAYS_BEFORE)(sample)
  const dateLabel = showDateLabel(show.date)

  const data: CommunicationData = {
    showId,
    showTitle: show.title,
    clubName: club.name,
    recipients: context.recipients.map((recipient) => ({
      artistId: recipient.artistId,
      name: recipient.name,
      whatsapp: recipient.whatsapp ? formatWhatsAppNumber(recipient.whatsapp) : null,
      waLink: recipient.whatsapp
        ? waMeLink(recipient.whatsapp, `Hi ${recipient.name}! I'm setting up a WhatsApp group for ${show.title} on ${dateLabel}. – ${club.name}`)
        : null,
    })),
    change: notice
      ? { headline: changeHeadline(notice), lines: changeLines(notice), suggestion: suggestedChangeMessage(notice, show.title) }
      : null,
    reminder: {
      showSetting: show.lineup_reminder_enabled,
      clubDefault: club.lineup_reminder_default,
      enabled: reminderEnabled(show, club.lineup_reminder_default),
      plan,
      confirmed: confirmedSpots.length,
      sent: confirmedSpots.filter((spot) => spot.lineup_reminder_sent_at).length,
      arrivalTime: show.lineup_arrival_time?.slice(0, 5) ?? '',
      preview: { subject: preview.subject, html: preview.html },
    },
    group: {
      name: lineupGroupName(show.title, show.date),
      pinned: pinnedInfo(details),
      link: show.lineup_group_link,
    },
    history,
  }

  return <CommunicationPanel data={data} />
}
