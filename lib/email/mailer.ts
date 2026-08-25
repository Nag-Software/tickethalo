import { resend, FROM_EMAIL, fromWithName } from '@/lib/resend'
import QRCode from 'qrcode'
import { formatTicketCode } from '@/lib/tickets'
import {
  artistApprovedTemplate,
  artistFeeTemplate,
  artistRegisteredTemplate,
  bookingConfirmedTemplate,
  bookingOfferTemplate,
  escapeHtml,
  offerDeclinedTemplate,
  spotAvailableTemplate,
  spotFilledTemplate,
  type EmailTemplate,
  type OfferTemplateInput,
} from './templates'

type EmailResult = { success: boolean; resendId?: string; error?: string }

// ─────────────────────────────────────────────────────────────
// Komikerpostene — malene ligger i ./templates
// ─────────────────────────────────────────────────────────────
async function sendArtistEmail(to: string, template: EmailTemplate): Promise<EmailResult> {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: template.subject,
      text: template.text,
      html: template.html,
    })
    if (error) throw new Error(error.message)
    return { success: true, resendId: data?.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}

export async function sendArtistRegisteredEmail(opts: {
  email: string
  full_name: string
}): Promise<EmailResult> {
  return sendArtistEmail(opts.email, artistRegisteredTemplate(opts))
}

export async function sendArtistApprovedEmail(opts: {
  email: string
  full_name: string
  portal_url: string
}): Promise<EmailResult> {
  return sendArtistEmail(opts.email, artistApprovedTemplate(opts))
}

export async function sendBookingOfferEmail(opts: OfferTemplateInput & {
  email: string
  token: string
}): Promise<EmailResult> {
  return sendArtistEmail(opts.email, bookingOfferTemplate(opts))
}

export async function sendSpotAvailableEmail(opts: OfferTemplateInput & {
  email: string
  token: string
}): Promise<EmailResult> {
  return sendArtistEmail(opts.email, spotAvailableTemplate(opts))
}

export async function sendBookingConfirmedEmail(opts: {
  email: string
  full_name: string
  show_title: string
  show_date: string
  show_time?: string | null
  venue?: string | null
  fee_label?: string | null
  portal_url?: string | null
}): Promise<EmailResult> {
  return sendArtistEmail(opts.email, bookingConfirmedTemplate(opts))
}

export async function sendOfferDeclinedEmail(opts: {
  email: string
  full_name: string
  show_title: string
  show_date: string
  portal_url?: string | null
}): Promise<EmailResult> {
  return sendArtistEmail(opts.email, offerDeclinedTemplate(opts))
}

export async function sendSpotFilledEmail(opts: {
  email: string
  full_name: string
  show_title?: string | null
}): Promise<EmailResult> {
  return sendArtistEmail(opts.email, spotFilledTemplate(opts))
}

/**
 * Fakturagrunnlaget etter showet — beløpet komikeren skal fakturere klubben.
 * Regnestykket ligger i `lib/artist-fees.ts`.
 */
export async function sendArtistFeeEmail(opts: {
  email: string
  full_name: string
  show_title: string
  show_date: string
  venue?: string | null
  amount: number
  currency: string
  bank_account_number?: string | null
  fee_basis: 'fixed' | 'percent' | 'none'
  percent?: number | null
  club_name?: string | null
  club_legal_name?: string | null
  club_org_number?: string | null
  club_invoice_email?: string | null
}): Promise<EmailResult> {
  return sendArtistEmail(opts.email, artistFeeTemplate(opts))
}

// ─────────────────────────────────────────────────────────────
// Ticket purchase confirmation
// ─────────────────────────────────────────────────────────────
/**
 * Selgeren av billetten. Klubben er arrangør og selger — Tickethalo
 * formidler adgangen. Blokken må stå på billetten uansett hva klubben har
 * skrudd på av kvitteringsepost i Stripe.
 */
export type TicketSeller = {
  name: string
  legal_name?: string | null
  org_number?: string | null
  support_email?: string | null
}

export type PurchasedTicket = {
  code: string
  /** Navnet billetten gjelder. Null viser kjøperens eget navn. */
  holderName?: string | null
  /** Adressen QR-koden peker på. Én per billett. */
  verificationUrl: string
}

/**
 * Billettene i én ordre.
 *
 * Én e-post med én QR per billett, framfor én e-post per billett: kjøpte du
 * fire, skal du ikke lete i fire tråder i døra. Hver QR er sin egen
 * vedlegg-CID, fordi e-postklienter ikke deler bilder mellom blokker.
 */
export async function sendTicketPurchaseEmail(opts: {
  email: string
  buyer_name: string
  show_title: string
  show_date: string
  show_time?: string | null
  venue_name: string
  venue_address?: string | null
  tickets: PurchasedTicket[]
  seller?: TicketSeller | null
}): Promise<EmailResult> {
  const tickets = opts.tickets.filter((ticket) => ticket.code)
  if (tickets.length === 0) return { success: false, error: 'no tickets to send' }

  const many = tickets.length > 1
  const subject = many
    ? `Billettene dine til ${opts.show_title} (${tickets.length})`
    : `Din billett til ${opts.show_title}`

  try {
    const attachments = await Promise.all(
      tickets.map(async (ticket, index) => ({
        filename: `tickethalo-ticket-${index + 1}.png`,
        content: await QRCode.toBuffer(ticket.verificationUrl, {
          type: 'png',
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 360,
          color: { dark: '#111827', light: '#ffffff' },
        }),
        contentType: 'image/png',
        contentId: `ticket-qr-${index + 1}`,
      })),
    )

    const displayName = escapeHtml(opts.buyer_name || opts.email)
    const showTitle = escapeHtml(opts.show_title || 'Tickethalo')
    const showDate = escapeHtml(opts.show_date || 'Dato kommer')
    const showTime = escapeHtml(opts.show_time || 'Tid kommer')
    const venueName = escapeHtml(opts.venue_name || 'Sted kommer')
    const venueAddress = escapeHtml(opts.venue_address)

    const seller = opts.seller ?? null
    const sellerName = seller?.legal_name?.trim() || seller?.name?.trim() || null
    const sellerLines = [
      sellerName,
      seller?.org_number ? `Org.nr ${seller.org_number}` : null,
      seller?.support_email,
    ].filter((line): line is string => Boolean(line))

    const sellerText = sellerName
      ? `\nSelger og arrangør: ${sellerLines.join(' · ')}\nBillett formidlet gjennom Tickethalo. Spørsmål om arrangementet rettes til arrangøren.\nBillettprisen er uten merverdiavgift — adgang til kulturarrangement er unntatt mva. (mval. § 3-7).\n`
      : ''

    const sellerHtml = sellerName
      ? `
                <div style="margin-top:26px;border-top:1px solid #e4e4e7;padding-top:18px">
                  <div style="font-size:12px;color:#71717a;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Selger og arrangør</div>
                  <div style="font-size:15px;font-weight:700;color:#18181b;margin-top:6px">${escapeHtml(sellerName)}</div>
                  ${seller?.org_number ? `<div style="font-size:13px;color:#52525b;margin-top:2px">Org.nr ${escapeHtml(seller.org_number)}</div>` : ''}
                  ${seller?.support_email ? `<div style="font-size:13px;color:#52525b;margin-top:2px"><a href="mailto:${escapeHtml(seller.support_email)}" style="color:#52525b">${escapeHtml(seller.support_email)}</a></div>` : ''}
                  <p style="margin:12px 0 0;color:#71717a;font-size:12px;line-height:1.6">Billetten er formidlet gjennom Tickethalo. Spørsmål om arrangementet, ombooking og refusjon rettes til arrangøren.<br />Billettprisen er uten merverdiavgift — adgang til kulturarrangement er unntatt mva. (mval. § 3-7).</p>
                </div>`
      : ''

    const ticketBlocks = tickets
      .map((ticket, index) => {
        const holder = escapeHtml(ticket.holderName?.trim() || opts.buyer_name || '')
        const label = many ? `Billett ${index + 1} av ${tickets.length}` : 'Billett'
        return `
                <div style="margin-top:${index === 0 ? '26' : '14'}px;border:1px solid #e4e4e7;border-radius:14px;padding:18px">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="vertical-align:middle">
                        <div style="font-size:12px;color:#71717a;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">${escapeHtml(label)}</div>
                        ${holder ? `<div style="font-size:19px;font-weight:800;color:#18181b;margin-top:4px">${holder}</div>` : ''}
                        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:20px;font-weight:700;letter-spacing:0.12em;color:#18181b;margin-top:8px;word-break:break-all">${escapeHtml(formatTicketCode(ticket.code))}</div>
                      </td>
                      <td style="width:150px;text-align:center;vertical-align:middle">
                        <img src="cid:ticket-qr-${index + 1}" width="132" height="132" alt="QR-kode for billett" style="display:block;border:0;width:132px;height:132px;margin:0 auto" />
                      </td>
                    </tr>
                  </table>
                </div>`
      })
      .join('')

    const ticketText = tickets
      .map((ticket, index) => {
        const holder = ticket.holderName?.trim() || opts.buyer_name || ''
        const label = many ? `Billett ${index + 1} av ${tickets.length}` : 'Billett'
        return `${label}${holder ? ` — ${holder}` : ''}\nBillettkode: ${formatTicketCode(ticket.code)}\nQR-verifisering: ${ticket.verificationUrl}`
      })
      .join('\n\n')

    const { data, error } = await resend.emails.send({
      from: sellerName ? fromWithName(sellerName) : FROM_EMAIL,
      to: opts.email,
      subject,
      attachments,
      text: `Hei ${opts.buyer_name || opts.email}\n\nTakk for kjøpet. ${many ? `Her er de ${tickets.length} billettene dine` : 'Dette er billetten din'} til ${opts.show_title}.\n\nDato: ${opts.show_date}\nTid: ${opts.show_time ?? 'Tid kommer'}\nSted: ${opts.venue_name}${opts.venue_address ? `, ${opts.venue_address}` : ''}\n\n${ticketText}\n\nVis QR-koden eller billettkoden i døren.\n${sellerText}`,
      html: `
        <div style="margin:0;background:#f4f4f5;padding:32px 12px;font-family:Inter,Arial,sans-serif;color:#18181b">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden">
            <tr>
              <td style="background:#111827;color:#ffffff;padding:28px 30px">
                <div style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#a7f3d0;font-weight:700">Tickethalo</div>
                <h1 style="margin:10px 0 0;font-size:30px;line-height:1.1;font-weight:800">${many ? `Billettene dine er klare` : 'Din billett er klar'}</h1>
                <p style="margin:10px 0 0;color:#d1d5db;font-size:15px;line-height:1.5">Hei ${displayName}, betalingen er godkjent. Vis ${many ? 'QR-kodene' : 'QR-koden'} i døren.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:30px">
                <div style="font-size:13px;color:#71717a;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Arrangement</div>
                <h2 style="margin:8px 0 20px;font-size:26px;line-height:1.2;color:#18181b">${showTitle}</h2>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align:top;padding-right:18px">
                      <div style="font-size:12px;color:#71717a;font-weight:700;text-transform:uppercase;letter-spacing:0.06em">Dato</div>
                      <div style="font-size:17px;font-weight:700;color:#18181b">${showDate}</div>
                    </td>
                    <td style="vertical-align:top;padding-right:18px">
                      <div style="font-size:12px;color:#71717a;font-weight:700;text-transform:uppercase;letter-spacing:0.06em">Tid</div>
                      <div style="font-size:17px;font-weight:700;color:#18181b">${showTime}</div>
                    </td>
                    <td style="vertical-align:top">
                      <div style="font-size:12px;color:#71717a;font-weight:700;text-transform:uppercase;letter-spacing:0.06em">Sted</div>
                      <div style="font-size:17px;font-weight:700;color:#18181b">${venueName}</div>
                      ${venueAddress ? `<div style="font-size:14px;color:#52525b;margin-top:2px">${venueAddress}</div>` : ''}
                    </td>
                  </tr>
                </table>
${ticketBlocks}

                <p style="margin:22px 0 0;color:#52525b;font-size:14px;line-height:1.6">${many ? 'Hver billett har sin egen QR-kode og gjelder én person.' : 'QR-koden og billettkoden er personlige.'} Ta med denne e-posten til inngangen, så scanner vi ${many ? 'billettene' : 'billetten'} og bekrefter at ${many ? 'de' : 'den'} er gyldig${many ? 'e' : ''}.</p>
${sellerHtml}
              </td>
            </tr>
          </table>
        </div>
      `,
    })
    if (error) throw new Error(error.message)
    return { success: true, resendId: data?.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}
