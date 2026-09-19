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
  role: 'rollen',
  energy: 'energinivået',
  gender: 'kjønnskravet',
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
  return req.quantity > 1 ? `${req.roleName} (${open} av ${req.quantity} ledig)` : req.roleName
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
          `Showet er spilt, og ${show.unreviewedSpots} ${show.unreviewedSpots === 1 ? 'komiker' : 'komikere'} er ikke vurdert.`,
          'Vurder lineupen',
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
            ? 'Utkastet er ikke startet, og lineup-fristen er passert.'
            : `Utkastet er ikke startet, og lineup-fristen er om ${daysToDeadline} ${daysToDeadline === 1 ? 'dag' : 'dager'}.`,
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
      add(
        'critical',
        'published-open',
        isShowDay
          ? 'Showet er i kveld, og en plass står tom. Systemet sender ikke tilbud på showdagen.'
          : 'Showet er publisert, men en plass har blitt ledig. Systemet fyller den igjen.',
        isShowDay ? 'Ring noen, eller slett plassen' : 'Følg med, og oppdater plakaten',
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
          ? 'Bookingen er ikke startet, så systemet sender ingen tilbud på dette showet.'
          : `${idleSpots.length} ${idleSpots.length === 1 ? 'plass er' : 'plasser er'} ikke med i bookingen, og får ingen tilbud.`,
        'Start booking',
      )
    }

    // ── Fylt, men kan ikke publiseres ──────────────────────────────────────
    if (show.requirements.length > 0 && openSpots.length === 0 && show.status !== 'published' && !show.clubPayoutReady) {
      add(
        'critical',
        'not-payable',
        'Lineupen er full, men showet kan ikke publiseres før klubbens utbetalingsoppsett er ferdig.',
        'Fullfør Økonomi',
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
        'Lineupen er full, men showet er ikke publisert. Billettsalget åpner ikke før dere publiserer.',
        'Se over og publiser',
      )
    }

    // ── Fristen ────────────────────────────────────────────────────────────
    if (openSpots.length > 0 && show.status !== 'published') {
      if (daysToDeadline < 0) {
        add(
          'critical',
          'deadline-passed',
          `Lineup-fristen er passert, og ${openSpots.length} ${openSpots.length === 1 ? 'plass står' : 'plasser står'} tom.`,
          'Fyll selv, eller slett plassen',
        )
      } else if (daysToDeadline <= settings.rush_days) {
        add(
          'warning',
          'deadline-near',
          daysToDeadline === 0
            ? `Lineup-fristen er i dag, og ${openSpots.length} ${openSpots.length === 1 ? 'plass står' : 'plasser står'} tom.`
            : `Lineup-fristen er om ${daysToDeadline} ${daysToDeadline === 1 ? 'dag' : 'dager'}, og ${openSpots.length} ${openSpots.length === 1 ? 'plass står' : 'plasser står'} tom.`,
          'Følg med, eller fyll selv',
        )
      }
    }

    // ── Et show uten plasser kan aldri publiseres ──────────────────────────
    if (show.requirements.length === 0) {
      add(
        'critical',
        'no-spots',
        'Showet har ingen plasser i lineupen, og kan ikke publiseres.',
        'Legg til minst én plass',
      )
    }

    // ── Per plass ──────────────────────────────────────────────────────────
    for (const req of openSpots) {
      const label = spotLabel(req)

      if (!req.submissionsOpen && req.matching === 0) {
        const hint = req.relaxable
          ? ` ${req.relaxable.count} ${req.relaxable.count === 1 ? 'komiker passer' : 'komikere passer'} om ${BLOCKER_TEXT[req.relaxable.blocker]} lempes.`
          : ''
        add(
          'critical',
          `no-candidates-${req.id}`,
          `Ingen på listen oppfyller kravene til plassen.${hint}`,
          'Lemp kravet, hent komikere, eller åpne for søknader',
          label,
        )
      } else if (!req.submissionsOpen && req.available === 0 && req.pendingAuto === 0 && req.pendingManual === 0) {
        add(
          'critical',
          `exhausted-${req.id}`,
          'Alle som oppfyller kravene har fått tilbud eller er tatt av showet, og ingen svar venter.',
          'Lemp kravet, hent komikere, eller send tilbud selv',
          label,
        )
      }

      if (req.oldestManualOfferAt) {
        const waitedDays = (now.getTime() - Date.parse(req.oldestManualOfferAt)) / (24 * 60 * 60 * 1000)
        if (waitedDays > MANUAL_OFFER_PATIENCE_DAYS) {
          add(
            'warning',
            `manual-wait-${req.id}`,
            `Ditt eget tilbud har ventet i ${Math.floor(waitedDays)} døgn og holder plassen.`,
            'Trekk tilbudet, så tar systemet over',
            label,
          )
        }
      }

      if (req.declined >= DECLINE_ALARM) {
        add(
          'warning',
          `declines-${req.id}`,
          `${req.declined} har sagt nei til denne plassen.`,
          'Sjekk honorar og krav',
          label,
        )
      }
    }

    // ── Søknader ───────────────────────────────────────────────────────────
    if (show.pendingSubmissions > 0) {
      add(
        'followup',
        'submissions',
        `${show.pendingSubmissions} ${show.pendingSubmissions === 1 ? 'søknad venter' : 'søknader venter'} på svar.`,
        'Svar',
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
  critical: 'Kritisk',
  warning: 'Advarsel',
  followup: 'Oppfølging',
}
