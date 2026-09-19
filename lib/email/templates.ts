/**
 * E-postmalene for komikerne — rene funksjoner, ingen utsending.
 *
 * Malene deler språk med komikerportalen: samme grunnfarge (`--ev-bg`),
 * samme blekk og samme aksent. Verdiene står som hex her fordi
 * e-postklienter ikke leser CSS-variabler — endres tokenene i
 * `app/globals.css`, må de speiles her.
 *
 * At de ligger utenfor `mailer.ts` gjør at en mal kan rendres uten å røre
 * Resend — nyttig når man vil se på en e-post før den sendes.
 */

import { appPath } from '@/lib/app-url'

export type EmailTemplate = { subject: string; html: string; text: string }

export function escapeHtml(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const BG = '#fdf4ed'
const CARD = '#fffaf6'
const LINE = '#e7dcd3'
const INK = '#2e0c01'
const MUTED = '#6d5147'
const ACCENT = '#ff5b24'

const PORTAL_BOOKINGS = appPath('/artist-app/bookings')
const PORTAL_DATES = appPath('/artist-app/availability')

/**
 * Beløp i minste valutaenhet. Formateres som i portalen (`nb-NO`) selv om
 * teksten er engelsk — komikeren skal se det samme tallet skrevet på samme
 * måte begge steder.
 */
function money(amount: number, currency: string) {
  // Ører vises bare når det faktisk er noen. Et honorar på 143,28 kr må stå
  // med ørene, ellers fakturerer komikeren 143 og beløpskontrollen slår ut på
  // en differanse ingen har gjort. Runde beløp skrives fortsatt «2 500 kr».
  const digits = amount % 100 === 0 ? 0 : 2
  return new Intl.NumberFormat('nb-NO', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount / 100)
}

/**
 * «Saturday 17 October 2026» — datoen slik den leses, ikke slik den lagres.
 *
 * Malene fikk `shows.date` rått, og komikeren leste «2026-10-17». Alt som ikke
 * ser ut som en ISO-dato slippes uendret gjennom, så en ferdig formatert tekst
 * ikke blir ødelagt. Datoen bygges i UTC midt på dagen: en showdato har ingen
 * tidssone, og skal ikke kunne tippe over til dagen før.
 */
export function showDateLabel(value: string | null | undefined, locale: 'en-GB' | 'nb-NO' = 'en-GB'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  if (!match) return value ?? ''
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
  if (Number.isNaN(at.getTime())) return value ?? ''
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(at)
}

function button(href: string, label: string, tone: 'primary' | 'ghost' = 'primary') {
  const style = tone === 'primary'
    ? `background:${INK};color:${BG};border:1px solid ${INK}`
    : `background:transparent;color:${INK};border:1px solid ${LINE}`
  return `<div style="margin:24px 0 0"><a href="${href}" style="display:inline-block;${style};text-decoration:none;padding:13px 22px;border-radius:999px;font-size:15px;font-weight:600">${escapeHtml(label)}</a></div>`
}

/** Etikett/verdi-rader — samme detaljer som tilbudssiden viser. */
function details(rows: Array<[string, string | null | undefined]>) {
  const visible = rows.filter(([, value]) => Boolean(value))
  if (!visible.length) return ''
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0 0;border-top:1px solid ${LINE}">
      ${visible.map(([label, value]) => `
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${LINE};font-size:14px;color:${MUTED}">${escapeHtml(label)}</td>
        <td style="padding:11px 0;border-bottom:1px solid ${LINE};font-size:14px;font-weight:600;color:${INK};text-align:right">${escapeHtml(value)}</td>
      </tr>`).join('')}
    </table>`
}

function paragraph(html: string, muted = false) {
  return `<p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:${muted ? MUTED : INK}">${html}</p>`
}

function note(strong: string, rest: string) {
  return `<div style="margin:22px 0 0;border-radius:10px;background:${BG};border:1px solid ${LINE};padding:16px">
      <p style="margin:0;font-size:14px;line-height:1.6;color:${INK}"><strong>${escapeHtml(strong)}</strong> ${escapeHtml(rest)}</p>
    </div>`
}

function shell(opts: {
  eyebrow: string
  heading: string
  /** Ferdig HTML — alt utenfra må gjennom escapeHtml først. */
  body: string
}) {
  return `
    <div style="margin:0;background:${BG};padding:32px 12px;font-family:Inter,Helvetica,Arial,sans-serif;color:${INK}">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto">
        <tr>
          <td style="padding:0 4px 14px">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${ACCENT}">Tickethalo</div>
          </td>
        </tr>
        <tr>
          <td style="background:${CARD};border:1px solid ${LINE};border-radius:14px;padding:30px">
            <div style="font-size:13px;font-weight:600;color:${MUTED}">${escapeHtml(opts.eyebrow)}</div>
            <h1 style="margin:6px 0 0;font-size:27px;line-height:1.12;letter-spacing:-0.02em;font-weight:700;color:${INK}">${escapeHtml(opts.heading)}</h1>
            ${opts.body}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 4px 0;font-size:12px;line-height:1.6;color:${MUTED}">
            Tickethalo — the easiest way to run a comedy club.<br />
            Questions? Reply to this email or write to <a href="mailto:hei@tickethalo.com" style="color:${MUTED}">hei@tickethalo.com</a>.
          </td>
        </tr>
      </table>
    </div>`
}

// ─────────────────────────────────────────────────────────────
// Malene
// ─────────────────────────────────────────────────────────────

export function artistApprovedTemplate(opts: { full_name: string; portal_url: string }): EmailTemplate {
  return {
    subject: 'You are approved as a comedian',
    text: `Hi ${opts.full_name}\n\nYou are approved. Offers will start coming. Mark the evenings you cannot do here: ${opts.portal_url}`,
    html: shell({
      eyebrow: 'Profile approved',
      heading: `Congratulations, ${opts.full_name}!`,
      body:
        paragraph('You are approved as a comedian. Offers will start coming — you do not have to do anything to get them.') +
        paragraph('Mark the evenings you cannot do in the calendar, and you will never be offered those dates.', true) +
        button(opts.portal_url, 'Mark the dates you cannot do'),
    }),
  }
}

export type OfferTemplateInput = {
  full_name: string
  show_title: string
  show_date: string
  response_url: string
  show_time?: string | null
  venue?: string | null
  role_name?: string | null
  /** Ferdig formatert honorar — samme etikett som lineup-plassen viser. */
  fee_label?: string | null
  /**
   * Når tilbudet går ut, som ISO-tid. Fristen er ikke alltid sju dager:
   * den kortes ned mot lineup-fristen og showdagen, så teksten må lese den
   * faktiske datoen i stedet for å love en lengde. Se lib/booking-schedule.ts.
   */
  expires_at?: string | null
}

/** «Friday 14 March» — fristen slik komikeren leser den. */
function deadlineLabel(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null
  const at = new Date(expiresAt)
  if (Number.isNaN(at.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Oslo',
  }).format(at)
}

function offerBody(opts: OfferTemplateInput, intro: string) {
  return (
    paragraph(`Hi ${escapeHtml(opts.full_name)}, ${intro}`) +
    details([
      ['Date', showDateLabel(opts.show_date)],
      ['Time', opts.show_time],
      ['Venue', opts.venue],
      ['Role', opts.role_name],
      ['Fee', opts.fee_label],
    ]) +
    button(opts.response_url, 'See the offer and reply') +
    paragraph(
      deadlineLabel(opts.expires_at)
        ? `Reply by ${escapeHtml(deadlineLabel(opts.expires_at)!)}. First to accept gets the spot.`
        : 'First to accept gets the spot.',
      true,
    )
  )
}

function offerText(opts: OfferTemplateInput, intro: string) {
  return `Hi ${opts.full_name}\n\n${intro}\n\n${opts.show_title}\nDate: ${showDateLabel(opts.show_date)}\nTime: ${opts.show_time ?? 'Coming'}\nVenue: ${opts.venue ?? 'Coming'}\nRole: ${opts.role_name ?? 'Coming'}\nFee: ${opts.fee_label ?? 'See the offer'}\n\nReply here: ${opts.response_url}\n\n${deadlineLabel(opts.expires_at) ? `Reply by ${deadlineLabel(opts.expires_at)}. ` : ''}First to accept gets the spot.`
}

export function bookingOfferTemplate(opts: OfferTemplateInput): EmailTemplate {
  const intro = 'you have been offered a spot on this lineup.'
  return {
    subject: `Booking offer: ${opts.show_title}`,
    text: offerText(opts, intro),
    html: shell({
      eyebrow: 'Booking offer',
      heading: opts.show_title,
      body:
        offerBody(opts, intro) +
        note('Only accept dates that work.', 'Saying no costs you nothing. Accepting and then dropping out flags your profile.'),
    }),
  }
}

export function spotAvailableTemplate(opts: OfferTemplateInput): EmailTemplate {
  const intro = 'a spot just opened up on this lineup.'
  return {
    subject: `Spot open: ${opts.show_title}`,
    text: offerText(opts, intro),
    html: shell({
      eyebrow: 'Spot open',
      heading: opts.show_title,
      body: offerBody(opts, intro),
    }),
  }
}

export function bookingConfirmedTemplate(opts: {
  full_name: string
  show_title: string
  show_date: string
  show_time?: string | null
  venue?: string | null
  fee_label?: string | null
  portal_url?: string | null
  /**
   * Klubben satte komikeren rett inn i lineupen. Da har hen ikke svart på noe,
   * og «the club has been told» ville vært en rar ting å lese.
   */
  added_by_club?: boolean
}): EmailTemplate {
  const portal = opts.portal_url || PORTAL_BOOKINGS
  const how = opts.added_by_club ? 'The club has put you on the lineup.' : 'The club has been told.'
  return {
    subject: `Booking confirmed: ${opts.show_title}`,
    text: `Hi ${opts.full_name}\n\nYou are booked for ${opts.show_title}. ${how}\n\nDate: ${showDateLabel(opts.show_date)}\nTime: ${opts.show_time ?? 'Coming'}\nVenue: ${opts.venue ?? 'Coming'}\nFee: ${opts.fee_label ?? 'See the portal'}\n\nYour bookings: ${portal}`,
    html: shell({
      eyebrow: 'Booking confirmed',
      heading: 'You are on the lineup',
      body:
        paragraph(`Hi ${escapeHtml(opts.full_name)}, you are booked for <strong>${escapeHtml(opts.show_title)}</strong>. ${how}`) +
        details([
          ['Date', showDateLabel(opts.show_date)],
          ['Time', opts.show_time],
          ['Venue', opts.venue],
          ['Fee', opts.fee_label],
        ]) +
        button(portal, 'See your bookings') +
        paragraph('Something comes up? Tell us as early as you can — a spot we can refill is no problem.', true),
    }),
  }
}

/**
 * Et nei skal kvitteres like tydelig som et ja. Uten denne satt komikeren
 * igjen uten spor av at svaret kom fram.
 */
export function offerDeclinedTemplate(opts: {
  full_name: string
  show_title: string
  show_date: string
  portal_url?: string | null
}): EmailTemplate {
  const portal = opts.portal_url || PORTAL_DATES
  return {
    subject: `Reply registered: ${opts.show_title}`,
    text: `Hi ${opts.full_name}\n\nWe have registered that ${opts.show_title} on ${showDateLabel(opts.show_date)} does not work for you. The spot goes to someone else, and you will keep getting offers.`,
    html: shell({
      eyebrow: 'Reply registered',
      heading: 'Thanks for the reply',
      body:
        paragraph(`Hi ${escapeHtml(opts.full_name)}, we have registered that <strong>${escapeHtml(opts.show_title)}</strong> on ${escapeHtml(showDateLabel(opts.show_date))} does not work for you.`) +
        paragraph('The spot goes to another comedian. Saying no changes nothing for you — the offers keep coming.', true) +
        button(portal, 'Mark the dates you cannot do', 'ghost'),
    }),
  }
}

export function spotFilledTemplate(opts: { full_name: string; show_title?: string | null }): EmailTemplate {
  return {
    subject: 'Sorry — that spot is already taken',
    text: `Hi ${opts.full_name}\n\nThe spot was filled by another comedian just before your reply came through. We will keep you posted on new openings.`,
    html: shell({
      eyebrow: 'Spot taken',
      heading: 'Someone else got there first',
      body:
        paragraph(`Hi ${escapeHtml(opts.full_name)}, the spot${opts.show_title ? ` on <strong>${escapeHtml(opts.show_title)}</strong>` : ''} was filled by another comedian just before your reply came through.`) +
        paragraph('Nothing is held against you — you will keep getting offers as new spots open up.', true),
    }),
  }
}


/**
 * Påminnelsen om at fristen løper ut.
 *
 * Et tilbud som ingen svarer på, holder plassen låst til det går ut. For
 * komikeren er det som regel ikke et nei — e-posten er lest og glemt. Én
 * påminnelse tett på fristen henter inn de fleste av dem, og den sendes
 * bare én gang per tilbud.
 */
export function offerReminderTemplate(opts: OfferTemplateInput): EmailTemplate {
  const deadline = deadlineLabel(opts.expires_at)
  const intro = deadline
    ? `your offer for this show expires ${deadline}.`
    : 'your offer for this show is about to expire.'

  return {
    subject: `Reminder: ${opts.show_title}`,
    text: `Hi ${opts.full_name}\n\n${intro}\n\n${opts.show_title}\nDate: ${showDateLabel(opts.show_date)}\nTime: ${opts.show_time ?? 'Coming'}\nVenue: ${opts.venue ?? 'Coming'}\nRole: ${opts.role_name ?? 'Coming'}\nFee: ${opts.fee_label ?? 'See the offer'}\n\nReply here: ${opts.response_url}\n\nA no is just as useful to us as a yes — then the spot goes on.`,
    html: shell({
      eyebrow: 'Reminder',
      heading: opts.show_title,
      body:
        paragraph(`Hi ${escapeHtml(opts.full_name)}, ${escapeHtml(intro)}`) +
        details([
          ['Date', showDateLabel(opts.show_date)],
          ['Time', opts.show_time],
          ['Venue', opts.venue],
          ['Role', opts.role_name],
          ['Fee', opts.fee_label],
        ]) +
        button(opts.response_url, 'Reply now') +
        paragraph('A no is just as useful to us as a yes — then the spot goes on to the next comedian.', true),
    }),
  }
}

/**
 * Tilbudet er trukket fordi komikeren tok en annen kveld som kolliderer.
 *
 * Uten denne forsvinner tilbudet i stillhet, og komikeren sitter igjen med
 * en e-post som ikke virker lenger og ingen forklaring på hvorfor.
 */
export function offerWithdrawnConflictTemplate(opts: {
  full_name: string
  show_title: string
  show_date: string
  booked_show_title?: string | null
}): EmailTemplate {
  const because = opts.booked_show_title
    ? `you accepted ${opts.booked_show_title} the same evening`
    : 'you accepted another show the same evening'

  return {
    subject: `Offer withdrawn: ${opts.show_title}`,
    text: `Hi ${opts.full_name}\n\nWe have withdrawn your offer for ${opts.show_title} on ${showDateLabel(opts.show_date)}, because ${because}. Nobody can be in two places at once.\n\nThe spot goes to another comedian, and you keep getting offers as usual.`,
    html: shell({
      eyebrow: 'Offer withdrawn',
      heading: 'You are booked that evening',
      body:
        paragraph(`Hi ${escapeHtml(opts.full_name)}, we have withdrawn your offer for <strong>${escapeHtml(opts.show_title)}</strong> on ${escapeHtml(showDateLabel(opts.show_date))}, because ${escapeHtml(because)}.`) +
        paragraph('Nothing is held against you — this is the system making sure you are never double-booked. Offers keep coming as usual.', true),
    }),
  }
}

// ─────────────────────────────────────────────────────────────
// Når klubben endrer noe komikeren regner med
//
// Ingen av de tre fantes: et show kunne slettes, en komiker tas ut av lineupen
// og et tilbud trekkes uten at den det gjaldt fikk et ord. Komikeren satt
// igjen med en bekreftelse i innboksen og en kveld holdt av til ingenting.
// ─────────────────────────────────────────────────────────────

type ClubNoticeInput = {
  full_name: string
  show_title: string
  show_date: string
  club_name?: string | null
}

const clubLabel = (name: string | null | undefined) => name?.trim() || 'The club'

/** Showet er avlyst. `booked` skiller lineupen fra dem som bare hadde et tilbud. */
export function showCancelledTemplate(opts: ClubNoticeInput & { booked: boolean }): EmailTemplate {
  const club = clubLabel(opts.club_name)
  const date = showDateLabel(opts.show_date)
  const consequence = opts.booked
    ? 'Your spot on the lineup is cancelled with it, and the evening is free again.'
    : 'The offer we sent you no longer applies, and you do not need to reply.'

  return {
    subject: `Show cancelled: ${opts.show_title}`,
    text: `Hi ${opts.full_name}\n\n${club} has cancelled ${opts.show_title} on ${date}. ${consequence}\n\nNothing is held against you, and offers keep coming as usual.`,
    html: shell({
      eyebrow: 'Show cancelled',
      heading: opts.booked ? 'This show is cancelled' : 'This offer no longer applies',
      body:
        paragraph(`Hi ${escapeHtml(opts.full_name)}, ${escapeHtml(club)} has cancelled <strong>${escapeHtml(opts.show_title)}</strong> on ${escapeHtml(date)}. ${escapeHtml(consequence)}`) +
        paragraph('Nothing is held against you, and offers keep coming as usual.', true) +
        button(PORTAL_BOOKINGS, 'See your bookings', 'ghost'),
    }),
  }
}

/** Klubben tok komikeren ut av lineupen. Showet går som planlagt. */
export function removedFromLineupTemplate(opts: ClubNoticeInput): EmailTemplate {
  const club = clubLabel(opts.club_name)
  const date = showDateLabel(opts.show_date)

  return {
    subject: `Lineup change: ${opts.show_title}`,
    text: `Hi ${opts.full_name}\n\n${club} has changed the lineup for ${opts.show_title} on ${date}, and your spot has been removed. The evening is free again.\n\nThis was the club's decision and does not affect your profile. If it comes as a surprise, reply to this email and we will look into it.`,
    html: shell({
      eyebrow: 'Lineup change',
      heading: 'You are no longer on this lineup',
      body:
        paragraph(`Hi ${escapeHtml(opts.full_name)}, ${escapeHtml(club)} has changed the lineup for <strong>${escapeHtml(opts.show_title)}</strong> on ${escapeHtml(date)}, and your spot has been removed. The evening is free again.`) +
        paragraph('This was the club&#39;s decision and does not affect your profile. If it comes as a surprise, reply to this email and we will look into it.', true) +
        button(PORTAL_BOOKINGS, 'See your bookings', 'ghost'),
    }),
  }
}

/** Klubben trakk et tilbud som ikke var besvart. Lenken i den første e-posten virker ikke lenger. */
export function offerWithdrawnByClubTemplate(opts: ClubNoticeInput): EmailTemplate {
  const club = clubLabel(opts.club_name)
  const date = showDateLabel(opts.show_date)

  return {
    subject: `Offer withdrawn: ${opts.show_title}`,
    text: `Hi ${opts.full_name}\n\n${club} has withdrawn the offer for ${opts.show_title} on ${date}. You do not need to reply, and the link in the earlier email no longer works.\n\nNothing is held against you, and offers keep coming as usual.`,
    html: shell({
      eyebrow: 'Offer withdrawn',
      heading: 'This offer is no longer open',
      body:
        paragraph(`Hi ${escapeHtml(opts.full_name)}, ${escapeHtml(club)} has withdrawn the offer for <strong>${escapeHtml(opts.show_title)}</strong> on ${escapeHtml(date)}. You do not need to reply, and the link in the earlier email no longer works.`) +
        paragraph('Nothing is held against you, and offers keep coming as usual.', true),
    }),
  }
}

/**
 * Honoraret etter showet — én setning og en lenke.
 *
 * Eposten bar tidligere hele fakturagrunnlaget: beløp, referanse, mottaker,
 * org.nr, adresse og kontonummer i én tabell. Alt riktig, og det var
 * problemet — den som skal skrive én faktura måtte lese ni rader for å finne
 * de tre tallene som betyr noe.
 *
 * Nå står detaljene på `/fee/[token]`, som komikeren kan gå tilbake til, som
 * viser hvor fakturaen står, og som ikke blir utdatert i innboksen når
 * kontonummeret endres. Beløpet blir igjen i eposten, fordi det er det eneste
 * spørsmålet noen har når de åpner den.
 */
export function artistFeeTemplate(opts: {
  full_name: string
  show_title: string
  show_date: string
  /** Minste valutaenhet. */
  amount: number
  currency: string
  /** Siden med resten — beløp, referanse, hvem som faktureres. */
  invoice_url: string
}): EmailTemplate {
  const amount = money(opts.amount, opts.currency)

  return {
    subject: `Your fee for ${opts.show_title}: ${amount}`,
    text: [
      `Hi ${opts.full_name}`,
      '',
      `${opts.show_title} on ${showDateLabel(opts.show_date)} is settled, and your fee is ${amount}.`,
      '',
      'Everything you need to invoice us — the amount, the reference and who to send it to — is here:',
      opts.invoice_url,
    ].join('\n'),
    html: shell({
      eyebrow: 'Show settled',
      heading: `Your fee is ${amount}`,
      body:
        paragraph(`Hi ${escapeHtml(opts.full_name)}, <strong>${escapeHtml(opts.show_title)}</strong> is settled. Everything you need to invoice us is on one page — the amount, the reference to put on the invoice, and who to send it to.`) +
        button(opts.invoice_url, 'How to invoice us'),
    }),
  }
}

// ─────────────────────────────────────────────────────────────
// Til klubben
// ─────────────────────────────────────────────────────────────

/**
 * Lineupen er full — og showet er *ikke* publisert.
 *
 * Showet publiserte seg selv før, og gikk ut uten plakat, tekst og
 * billettsalg. Nå er dette e-posten som kommer i stedet: klubben ser over
 * siden og trykker Publiser selv. `missing` er det som fortsatt står tomt,
 * så e-posten sier hva som gjenstår og ikke bare at noe gjør det.
 */
export function lineupFullTemplate(opts: {
  full_name?: string | null
  show_title: string
  show_date: string
  /** Komikerne i lineupen, i rekkefølge. */
  lineup: string[]
  /** Det event-siden mangler, skrevet som det skal leses: «a poster». */
  missing: string[]
  /** Er ikke utbetalingsoppsettet ferdig, kan showet ikke publiseres ennå. */
  payout_ready: boolean
  show_url: string
}): EmailTemplate {
  const date = showDateLabel(opts.show_date)
  const greeting = opts.full_name?.trim() ? `Hi ${opts.full_name.trim()}` : 'Hi'
  const lineup = opts.lineup.join(', ')
  const missing = opts.missing.length > 0
    ? `Before you publish, the event page still needs ${joinList(opts.missing)}.`
    : 'The event page has everything it needs.'
  const payout = opts.payout_ready
    ? null
    : 'Ticket sales cannot open until the club’s payout setup is finished under Finances, so the show cannot be published before that is done.'

  return {
    subject: `Line-up is booked – Publish? ${opts.show_title}`,
    text: [
      greeting,
      '',
      `Every spot on ${opts.show_title} on ${date} is confirmed${lineup ? `: ${lineup}` : ''}.`,
      '',
      'The show is not published yet. Nothing goes live and no tickets are sold until you publish it yourself.',
      missing,
      ...(payout ? [payout] : []),
      '',
      'Review the show and publish when you are ready:',
      opts.show_url,
    ].join('\n'),
    html: shell({
      eyebrow: 'Line-up is booked',
      heading: 'Ready to publish?',
      body:
        paragraph(`${escapeHtml(greeting)}, every spot on <strong>${escapeHtml(opts.show_title)}</strong> on ${escapeHtml(date)} is confirmed.`) +
        details([['Line-up', lineup || null]]) +
        paragraph('The show is <strong>not published yet</strong>. Nothing goes live and no tickets are sold until you publish it yourself.') +
        paragraph(escapeHtml(missing), opts.missing.length === 0) +
        (payout ? paragraph(escapeHtml(payout), true) : '') +
        button(opts.show_url, 'Review and publish'),
    }),
  }
}

/** «a poster», «a poster and a description», «a poster, a description and a ticket price». */
function joinList(items: string[]) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
