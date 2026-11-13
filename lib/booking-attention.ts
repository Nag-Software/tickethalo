import type { RequirementBlocker } from '@/lib/booking-rules'
import { dateMinusDays, osloDateString } from '@/lib/booking-schedule'
import type { BookingSettings } from '@/lib/booking-settings'
import type { ShowStatus } from '@/types/database'

/**
 * «Trenger oppmerksomhet» — alt automatikken ikke klarer alene.
 *
 * Motoren gjetter aldri, og den senker aldri kravene i det stille. Når den
 * står fast, er det bookeren som må velge: lempe et krav, hente flere
 * komikere inn på listen, sende et tilbud selv, åpne for søknader — eller
 * slette plassen og kjøre showet med en komiker mindre.
 *
 * Uten denne listen måtte bookeren åpne hvert show for å se det. Da blir det
 * ikke gjort, og et show står med en tom plass til uken før.
 *
 * Ren funksjon, uten database: radene hentes i lib/booking-attention-data.ts.
 * Tellingen av kandidater der bruker de samme reglene som motoren
 * (lib/booking-rules.ts), så listen ikke kan si noe annet enn det motoren gjør.
 */

export type AttentionLevel = 'critical' | 'warning' | 'followup'

export type AttentionAlert = {
  /** Stabil nøkkel, så React ikke bygger raden på nytt ved hver visning. */
  id: string
  level: AttentionLevel
  showId: string
  showTitle: string
  showDate: string
  /** Plassen det gjelder. Null når varselet gjelder hele showet. */
  spot: string | null
  message: string
  action: string
  href: string
}

export type AttentionRequirement = {
  id: string
  roleName: string
  quantity: number
  filled: number
  /** Ubesvarte tilbud fra motoren. */
  pendingAuto: number
  /** Ubesvarte tilbud bookeren sendte selv. */
  pendingManual: number
  /** Eldste ubesvarte manuelle tilbud, ISO. Null = ingen. */
  oldestManualOfferAt: string | null
  /** Antall nei på plassen. */
  declined: number
  submissionsOpen: boolean
  /** Motoren jobber på plassen. Er den av, rører den den ikke. */
  autoStarted: boolean
  /**
   * En komiker er tatt ut, og plassen venter på at bookeren velger: plukke
   * selv eller «Auto-book new». Til da sender motoren ingenting. Se migrasjon 094.
   */
  rebookPaused?: boolean
  /**
   * Alle på klubbens liste som oppfyller kravene til plassen og kan den
   * kvelden — uansett om de har fått tilbud på showet allerede.
   */
  matching: number
  /** Av dem: de som fortsatt kan få et tilbud. */
  available: number
  /** Kravet som stenger flest ute, og hvor mange som kommer inn om det lempes. */
  relaxable: { blocker: RequirementBlocker; count: number } | null
}

export type AttentionShow = {
  id: string
  title: string
  date: string
  status: ShowStatus
  /** Klubbens egen frist, eller plattformens. */
  lineupDeadlineDays: number
  requirements: AttentionRequirement[]
  /** Søknader som venter på svar. */
  pendingSubmissions: number
  /** Bekreftede plasser på et spilt show som ennå ikke er vurdert. */
  unreviewedSpots: number
  /** Klubben kan ta imot penger. Uten dette kan showet ikke publiseres. */
  clubPayoutReady: boolean
}

export type AttentionInput = {
  shows: AttentionShow[]
  settings: BookingSettings
  now?: Date
}

const BLOCKER_TEXT: Record<RequirementBlocker, string> = {
  role: 'the role',
  energy: 'the energy level',
  gender: 'the gender requirement',
  skill: 'the skill level requirement',
}

/** Bookerens eget tilbud som holder setet lenger enn dette, er verdt et varsel. */
const MANUAL_OFFER_PATIENCE_DAYS = 3

/** Så mange nei på samme plass betyr som regel at honoraret eller kravet er feil. */
const DECLINE_ALARM = 3

/** Et utkast som ikke er startet når fristen er så nær, rekker det ikke. */
const DRAFT_ALARM_DAYS = 14

const LEVEL_ORDER: Record<AttentionLevel, number> = { critical: 0, warning: 1, followup: 2 }

function spotLabel(req: AttentionRequirement): string {
  const open = req.quantity - req.filled
  return req.quantity > 1 ? `${req.roleName} (${open} of ${req.quantity} open)` : req.roleName
}

function daysBetweenDates(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.round((end - start) / (24 * 60 * 60 * 1000))
}

/**
 * Varslene for klubbens kommende og nylig spilte show, viktigst først.
 *
 * Rekkefølgen er nivå og så showdato: det som haster mest, og av det igjen
 * den kvelden som kommer først.
 */
export function bookingAttention({ shows, settings, now = new Date() }: AttentionInput): AttentionAlert[] {
  const today = osloDateString(now)
  const alerts: AttentionAlert[] = []

  for (const show of shows) {
    const lineupTab = `/admin-app/shows/${show.id}?tab=lineup`
    const openSpots = show.requirements.filter((req) => req.filled < req.quantity)
    const deadlineDate = dateMinusDays(show.date, show.lineupDeadlineDays)
    const daysToDeadline = daysBetweenDates(today, deadlineDate)
    const played = show.date < today

    const add = (
      level: AttentionLevel,
      key: string,
      message: string,
      action: string,
      spot: string | null = null,
      href: string = lineupTab,
    ) => {
      alerts.push({
        id: `${show.id}:${key}`,
        level,
        showId: show.id,
        showTitle: show.title,
        showDate: show.date,
        spot,
        message,
        action,
        href,
      })
    }

    // ── Spilt: er kvelden vurdert? ─────────────────────────────────────────
    if (played) {
      if (show.unreviewedSpots > 0) {
        add(
          'followup',
          'unreviewed',
          `The show has been played, and ${show.unreviewedSpots} ${show.unreviewedSpots === 1 ? 'comedian has' : 'comedians have'} not been reviewed.`,
          'Review the lineup',
        )
      }
      continue
    }

    // ── Utkast: rekker vi fristen? ─────────────────────────────────────────
    if (show.status === 'draft') {
      if (daysToDeadline <= DRAFT_ALARM_DAYS) {
        add(
          'warning',
          'draft-late',
          daysToDeadline < 0
            ? 'The draft has not been started, and the lineup deadline has passed.'
            : `The draft has not been started, and the lineup deadline is in ${daysToDeadline} ${daysToDeadline === 1 ? 'day' : 'days'}.`,
          'Start booking',
        )
      }
      continue
    }

    // ── Publisert show som har mistet en komiker ───────────────────────────
    if (show.status === 'published' && openSpots.length > 0) {
      // På showdagen sender motoren ingenting — se `offerExpiresAt`. Da er
      // det bookeren som må ringe, og varselet skal ikke si at systemet
      // ordner det.
      const isShowDay = show.date === today
      // En pauset plass fyller ikke systemet — det venter på bookeren.
      const waitingOnBooker = openSpots.every((req) => req.rebookPaused)
      add(
        'critical',
        'published-open',
        isShowDay
          ? 'The show is tonight, and a spot is empty. The system does not send offers on the day of the show.'
          : waitingOnBooker
            ? 'The show is published, but a comedian has been removed. The spot stays open until you choose who fills it.'
            : 'The show is published, but a spot has opened up. The system will fill it again.',
        isShowDay ? 'Call someone, or delete the spot' : 'Keep an eye on it, and update the poster',
      )
    }

    // ── Motoren er ikke satt i gang ────────────────────────────────────────
    //
    // Et manuelt tilbud tar showet ut av utkast uten å starte bølgene. Showet
    // ser da i gang ut, mens motoren ikke rører en eneste plass.
    const idleSpots = show.requirements.filter((req) => !req.autoStarted && !req.submissionsOpen)
    if (show.status !== 'published' && idleSpots.length > 0 && openSpots.length > 0) {
      add(
        'critical',
        'not-started',
        idleSpots.length === show.requirements.length
          ? 'Booking has not been started, so the system is not sending any offers for this show.'
          : `${idleSpots.length} ${idleSpots.length === 1 ? 'spot is' : 'spots are'} not part of the booking and won't get any offers.`,
        'Start booking',
      )
    }

    // ── En komiker er tatt ut, og bookeren har ikke valgt ────────────────
    //
    // «Remove» starter ikke lenger en ny runde av seg selv. Lukker bookeren
    // spørsmålet uten å velge, står plassen tom til noen ser den her.
    const pausedSpots = openSpots.filter((req) => req.rebookPaused && !req.submissionsOpen && req.pendingManual === 0)
    if (show.status !== 'published' && pausedSpots.length > 0) {
      add(
        'warning',
        'rebook-paused',
        `A comedian has been removed, and ${pausedSpots.length === 1 ? 'the spot is' : `${pausedSpots.length} spots are`} waiting for you to choose. The system won't send any offers until then.`,
        'Pick yourself or auto-book',
        pausedSpots.length === 1 ? spotLabel(pausedSpots[0]) : null,
      )
    }

    // ── Fylt, men kan ikke publiseres ──────────────────────────────────────
    if (show.requirements.length > 0 && openSpots.length === 0 && show.status !== 'published' && !show.clubPayoutReady) {
      add(
        'critical',
        'not-payable',
        'The lineup is full, but the show can\'t be published until the club\'s payout setup is complete.',
        'Complete Finances',
        null,
        '/admin-app/finances',
      )
    }

    // ── Fylt, og venter på klubben ─────────────────────────────────────────
    //
    // Showet publiserer seg ikke selv. Klubben har fått «Line-up is booked –
    // Publish?», men en e-post kan bli liggende — og et show som står full og
    // upublisert selger ingen billetter.
    if (show.requirements.length > 0 && openSpots.length === 0 && show.status !== 'published' && show.clubPayoutReady) {
      add(
        'warning',
        'ready-to-publish',
        'The lineup is full, but the show is not published. Ticket sales won\'t open until you publish.',
        'Review and publish',
      )
    }

    // ── Fristen ────────────────────────────────────────────────────────────
    if (openSpots.length > 0 && show.status !== 'published') {
      if (daysToDeadline < 0) {
        add(
          'critical',
          'deadline-passed',
          `The lineup deadline has passed, and ${openSpots.length} ${openSpots.length === 1 ? 'spot is' : 'spots are'} empty.`,
          'Fill it yourself, or delete the spot',
        )
      } else if (daysToDeadline <= settings.rush_days) {
        add(
          'warning',
          'deadline-near',
          daysToDeadline === 0
            ? `The lineup deadline is today, and ${openSpots.length} ${openSpots.length === 1 ? 'spot is' : 'spots are'} empty.`
            : `The lineup deadline is in ${daysToDeadline} ${daysToDeadline === 1 ? 'day' : 'days'}, and ${openSpots.length} ${openSpots.length === 1 ? 'spot is' : 'spots are'} empty.`,
          'Keep an eye on it, or fill it yourself',
        )
      }
    }

    // ── Et show uten plasser kan aldri publiseres ──────────────────────────
    if (show.requirements.length === 0) {
      add(
        'critical',
        'no-spots',
        'The show has no spots in the lineup and can\'t be published.',
        'Add at least one spot',
      )
    }

    // ── Per plass ──────────────────────────────────────────────────────────
    for (const req of openSpots) {
      const label = spotLabel(req)

      if (!req.submissionsOpen && req.matching === 0) {
        const hint = req.relaxable
          ? ` ${req.relaxable.count} ${req.relaxable.count === 1 ? 'comedian fits' : 'comedians fit'} if ${BLOCKER_TEXT[req.relaxable.blocker]} is relaxed.`
          : ''
        add(
          'critical',
          `no-candidates-${req.id}`,
          `No one on the list meets the requirements for this spot.${hint}`,
          'Relax the requirement, add comedians, or open for submissions',
          label,
        )
      } else if (!req.submissionsOpen && req.available === 0 && req.pendingAuto === 0 && req.pendingManual === 0) {
        add(
          'critical',
          `exhausted-${req.id}`,
          'Everyone who meets the requirements has had an offer or been taken off the show, and no replies are pending.',
          'Relax the requirement, add comedians, or send an offer yourself',
          label,
        )
      }

      if (req.oldestManualOfferAt) {
        const waitedDays = (now.getTime() - Date.parse(req.oldestManualOfferAt)) / (24 * 60 * 60 * 1000)
        if (waitedDays > MANUAL_OFFER_PATIENCE_DAYS) {
          add(
            'warning',
            `manual-wait-${req.id}`,
            `Your own offer has been waiting for ${Math.floor(waitedDays)} ${Math.floor(waitedDays) === 1 ? 'day' : 'days'} and is holding the spot.`,
            'Withdraw the offer and the system takes over',
            label,
          )
        }
      }

      if (req.declined >= DECLINE_ALARM) {
        add(
          'warning',
          `declines-${req.id}`,
          `${req.declined} have declined this spot.`,
          'Check the fee and requirements',
          label,
        )
      }
    }

    // ── Søknader ───────────────────────────────────────────────────────────
    if (show.pendingSubmissions > 0) {
      add(
        'followup',
        'submissions',
        `${show.pendingSubmissions} ${show.pendingSubmissions === 1 ? 'submission is' : 'submissions are'} waiting for a reply.`,
        'Reply',
        null,
        `/admin-app/shows/${show.id}?tab=submissions`,
      )
    }
  }

  return alerts.sort((a, b) =>
    LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]
    || (a.showDate < b.showDate ? -1 : a.showDate > b.showDate ? 1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

export const ATTENTION_LEVEL_LABELS: Record<AttentionLevel, string> = {
  critical: 'Critical',
  warning: 'Warning',
  followup: 'Follow-up',
}
