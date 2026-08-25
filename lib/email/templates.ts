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

const PORTAL_BOOKINGS = 'https://tickethalo.com/artist-app/bookings'
const PORTAL_DATES = 'https://tickethalo.com/artist-app/available-dates'
const PORTAL_ECONOMY = 'https://tickethalo.com/artist-app/economy'
const PORTAL_PROFILE = 'https://tickethalo.com/artist-app/profile'

/**
 * Beløp i minste valutaenhet. Formateres som i portalen (`nb-NO`) selv om
 * teksten er engelsk — komikeren skal se det samme tallet skrevet på samme
 * måte begge steder.
 */
function money(amount: number, currency: string) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount / 100)
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

export function artistRegisteredTemplate(opts: { full_name: string }): EmailTemplate {
  return {
    subject: 'Welcome — we have your application',
    text: `Hi ${opts.full_name}\n\nWe have your registration and will review it shortly. You will get an email as soon as your profile is approved.`,
    html: shell({
      eyebrow: 'Application received',
      heading: `Hi ${opts.full_name}!`,
      body:
        paragraph('We have your registration and will go through it shortly.') +
        paragraph('You will get an email as soon as your profile is approved — then you can set the dates you are available.', true),
    }),
  }
}

export function artistApprovedTemplate(opts: { full_name: string; portal_url: string }): EmailTemplate {
  return {
    subject: 'You are approved as a comedian',
    text: `Hi ${opts.full_name}\n\nYou are approved. Sign in and pick the dates you are available: ${opts.portal_url}`,
    html: shell({
      eyebrow: 'Profile approved',
      heading: `Congratulations, ${opts.full_name}!`,
      body:
        paragraph('You are approved as a comedian. Pick the dates you are actually available, and offers will start coming.') +
        paragraph('The booking team uses those dates together with your score and energy level when shows are matched.', true) +
        button(opts.portal_url, 'Pick your dates'),
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
}

function offerBody(opts: OfferTemplateInput, intro: string) {
  return (
    paragraph(`Hi ${escapeHtml(opts.full_name)}, ${intro}`) +
    details([
      ['Date', opts.show_date],
      ['Time', opts.show_time],
      ['Venue', opts.venue],
      ['Role', opts.role_name],
      ['Fee', opts.fee_label],
    ]) +
    button(opts.response_url, 'See the offer and reply') +
    paragraph('Open for 7 days. First to accept gets the spot.', true)
  )
}

function offerText(opts: OfferTemplateInput, intro: string) {
  return `Hi ${opts.full_name}\n\n${intro}\n\n${opts.show_title}\nDate: ${opts.show_date}\nTime: ${opts.show_time ?? 'Coming'}\nVenue: ${opts.venue ?? 'Coming'}\nRole: ${opts.role_name ?? 'Coming'}\nFee: ${opts.fee_label ?? 'See the offer'}\n\nReply here: ${opts.response_url}\n\nOpen for 7 days. First to accept gets the spot.`
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
}): EmailTemplate {
  const portal = opts.portal_url || PORTAL_BOOKINGS
  return {
    subject: `Booking confirmed: ${opts.show_title}`,
    text: `Hi ${opts.full_name}\n\nYou are booked for ${opts.show_title}.\n\nDate: ${opts.show_date}\nTime: ${opts.show_time ?? 'Coming'}\nVenue: ${opts.venue ?? 'Coming'}\nFee: ${opts.fee_label ?? 'See the portal'}\n\nYour bookings: ${portal}`,
    html: shell({
      eyebrow: 'Booking confirmed',
      heading: 'You are on the lineup',
      body:
        paragraph(`Hi ${escapeHtml(opts.full_name)}, you are booked for <strong>${escapeHtml(opts.show_title)}</strong>. The club has been told.`) +
        details([
          ['Date', opts.show_date],
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
    text: `Hi ${opts.full_name}\n\nWe have registered that ${opts.show_title} on ${opts.show_date} does not work for you. The spot goes to someone else, and you will keep getting offers.`,
    html: shell({
      eyebrow: 'Reply registered',
      heading: 'Thanks for the reply',
      body:
        paragraph(`Hi ${escapeHtml(opts.full_name)}, we have registered that <strong>${escapeHtml(opts.show_title)}</strong> on ${escapeHtml(opts.show_date)} does not work for you.`) +
        paragraph('The spot goes to another comedian. Saying no changes nothing for you — the offers keep coming.', true) +
        button(portal, 'Update your available dates', 'ghost'),
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
 * Honoraret etter showet — fakturagrunnlaget.
 *
 * Komikeren fakturerer klubben; eposten er grunnlaget den fakturaen skrives
 * fra. Da må alt som skal stå på fakturaen være her: beløpet, hvem den
 * sendes til, og hvilket show den gjelder. Kontonummeret komikeren har ført
 * i portalen står med, fordi det er det klubben betaler til — mangler det,
 * sier eposten det rett ut i stedet for å la det oppdages ved forfall.
 */
export function artistFeeTemplate(opts: {
  full_name: string
  show_title: string
  show_date: string
  venue?: string | null
  /** Minste valutaenhet. */
  amount: number
  currency: string
  bank_account_number?: string | null
  fee_basis: 'fixed' | 'percent' | 'none'
  percent?: number | null
  club_name?: string | null
  /** Klubbens fakturamottaker — juridisk navn, org.nr og epost. */
  club_legal_name?: string | null
  club_org_number?: string | null
  club_invoice_email?: string | null
}): EmailTemplate {
  const amount = money(opts.amount, opts.currency)
  const basisLabel = opts.fee_basis === 'percent' && opts.percent != null
    ? `${opts.percent}% of ticket sales`
    : opts.fee_basis === 'fixed'
      ? 'Agreed fixed fee'
      : null
  const billTo = opts.club_legal_name?.trim() || opts.club_name?.trim() || null
  const reference = `${opts.show_title} — ${opts.show_date}`
  const invoiceEmail = opts.club_invoice_email?.trim() || null

  const textLines = [
    `Hi ${opts.full_name}`,
    '',
    `${opts.show_title} on ${opts.show_date} is settled. Your fee is ${amount} — send an invoice for that amount and the club pays it.`,
    '',
    `Amount to invoice: ${amount}`,
    basisLabel ? `Agreement: ${basisLabel}` : null,
    `Reference: ${reference}`,
    billTo ? `Invoice to: ${billTo}` : null,
    opts.club_org_number ? `Registration number: ${opts.club_org_number}` : null,
    invoiceEmail ? `Send the invoice to: ${invoiceEmail}` : null,
    opts.bank_account_number
      ? `Paid to your account: ${opts.bank_account_number}`
      : 'No account number is registered on your profile — add it in the portal, and put it on the invoice.',
    '',
    `Your fees: ${PORTAL_ECONOMY}`,
  ].filter((line) => line !== null)

  return {
    subject: `Invoice us for ${opts.show_title}: ${amount}`,
    text: textLines.join('\n'),
    html: shell({
      eyebrow: 'Show settled',
      heading: `Invoice us for ${amount}`,
      body:
        paragraph(`Hi ${escapeHtml(opts.full_name)}, <strong>${escapeHtml(opts.show_title)}</strong> is settled and your fee is <strong>${escapeHtml(amount)}</strong>. Send an invoice for that amount${billTo ? ` to ${escapeHtml(billTo)}` : ''}, and it gets paid.`) +
        details([
          ['Amount to invoice', amount],
          ['Agreement', basisLabel],
          ['Reference', reference],
          ['Venue', opts.venue],
          ['Invoice to', billTo],
          ['Registration number', opts.club_org_number],
          ['Send the invoice to', invoiceEmail],
          ['Paid to your account', opts.bank_account_number],
        ]) +
        (opts.bank_account_number
          ? paragraph('Wrong account number? Change it in the portal — it is the account the club pays to.', true) +
            button(PORTAL_ECONOMY, 'See your fees')
          : note('No account number registered.', 'Put your account number on the invoice, and add it in the portal so the club has it on file.') +
            button(PORTAL_PROFILE, 'Add account number')),
    }),
  }
}
