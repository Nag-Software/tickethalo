import { resend, FROM_EMAIL } from '@/lib/resend'
import {
  formatBookingDate,
  formatBookingHonorar,
  formatBookingSpotLabel,
} from '@/lib/booking-offer-format'
import QRCode from 'qrcode'

type EmailResult = { success: boolean; resendId?: string; error?: string }

function escapeHtml(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─────────────────────────────────────────────────────────────
// Artist registered
// ─────────────────────────────────────────────────────────────
export async function sendArtistRegisteredEmail(opts: {
  email: string
  full_name: string
}): Promise<EmailResult> {
  const subject = 'Velkommen — din søknad er mottatt'
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: opts.email,
      subject,
      html: `
        <h2>Hei ${escapeHtml(opts.full_name)}!</h2>
        <p>Vi har mottatt din registrering og går gjennom den snart.</p>
        <p>Du vil motta en e-post når du er godkjent.</p>
      `,
    })
    if (error) throw new Error(error.message)
    return { success: true, resendId: data?.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}

// ─────────────────────────────────────────────────────────────
// Artist approved
// ─────────────────────────────────────────────────────────────
export async function sendArtistApprovedEmail(opts: {
  email: string
  full_name: string
  portal_url: string
}): Promise<EmailResult> {
  const subject = 'Du er godkjent som artist!'
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: opts.email,
      subject,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;color:#18181b;line-height:1.55">
          <h2>Gratulerer, ${escapeHtml(opts.full_name)}!</h2>
          <p>Du er nå godkjent som artist. Logg inn på artistportalen og velg opptil tre datoer du faktisk er tilgjengelig for.</p>
          <p>Booking-teamet bruker datoene sammen med score og energinivå når show matcher automatisk.</p>
          <p><a href="${opts.portal_url}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px">Velg ledige datoer</a></p>
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

// ─────────────────────────────────────────────────────────────
// Booking offer
// ─────────────────────────────────────────────────────────────
export async function sendBookingOfferEmail(opts: {
  email: string
  full_name: string
  show_title: string
  show_date: string
  show_start_time?: string | null
  show_end_time?: string | null
  club_name?: string | null
  spot_type?: string | null
  venue_name?: string | null
  venue_address?: string | null
  fee_amount?: number | null   // stored in øre/cents
  currency?: string | null
  compensation_type?: string | null
  compensation_amount?: number | null
  compensation_percent?: number | null
  token: string
  response_url: string
}): Promise<EmailResult> {
  const clubLabel = opts.club_name?.trim() || opts.show_title
  const spotLabel = formatBookingSpotLabel(opts.spot_type)
  const dateLabel = formatBookingDate(opts.show_date)
  // Date keeps each offer's subject unique so Gmail does not thread them
  // together and collapse the «Svar her» button behind the trimmed quote.
  const subject = `${clubLabel} vil booke deg — ${dateLabel}`

  // Use the shared honorar formatter so percent revenue-share offers show the real
  // terms ("50% av billettinntekter") instead of "Ikke oppgitt" — matching what the
  // confirmation email and the public accept page already display.
  const feeFormatted = formatBookingHonorar(opts)

  const detailRow = (label: string, value: string) =>
    `<tr><td style="color:#71717a;padding:6px 0;width:120px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 0;font-weight:500">${escapeHtml(value)}</td></tr>`

  const startLabel = opts.show_start_time ? opts.show_start_time.slice(0, 5) : null
  const endLabel = opts.show_end_time ? opts.show_end_time.slice(0, 5) : null
  const timeLabel = startLabel && endLabel
    ? `${startLabel}–${endLabel}`
    : startLabel ?? 'Ikke oppgitt'

  const detailRows = [
    detailRow('Spot', spotLabel),
    detailRow('Honorar', feeFormatted),
    detailRow('Venue/Scene', opts.venue_name?.trim() || 'Ikke oppgitt'),
    detailRow('Adresse', opts.venue_address?.trim() || 'Ikke oppgitt'),
    detailRow('Dato', dateLabel),
    detailRow('Start / slutt', timeLabel),
  ].join('')

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: opts.email,
      subject,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;color:#18181b;line-height:1.55;max-width:540px">
          <h2 style="margin-bottom:4px">Hei ${escapeHtml(opts.full_name)}!</h2>
          <p>${escapeHtml(clubLabel)} vil gjerne booke deg til en ${escapeHtml(spotLabel)} spot.</p>

          <p style="margin:18px 0">
            <a href="${opts.response_url}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">Svar på tilbudet</a>
          </p>

          <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px">
            ${detailRows}
          </table>

          <p>Det er helt fint å takke nei til spots, du blir ikke nedprioritert av den grunn.</p>
          <p>På den annen side skaper det merarbeid for bookere om du sier ja til en spot, og i etterkant dropper. Sjekk at du kan stille før du takker ja.</p>
          <p style="margin-top:18px;color:#52525b">P.S. Passer ikke denne datoen, vil det være nye muligheter snart:)</p>
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

// ─────────────────────────────────────────────────────────────
// Booking confirmed
// ─────────────────────────────────────────────────────────────
export async function sendBookingConfirmedEmail(opts: {
  email: string
  full_name: string
  club_name: string
  venue_name?: string | null
  venue_address?: string | null
  show_date: string
  spot_type?: string | null
  fee_amount?: number | null
  currency?: string | null
  compensation_type?: string | null
  compensation_amount?: number | null
  compensation_percent?: number | null
}): Promise<EmailResult> {
  const clubLabel = opts.club_name.trim()
  const spotLabel = formatBookingSpotLabel(opts.spot_type)
  const honorar = formatBookingHonorar(opts)
  const subject = `Du er booket hos ${clubLabel}`

  const detailRow = (label: string, value: string) =>
    `<tr><td style="color:#71717a;padding:6px 0;width:120px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 0;font-weight:500">${escapeHtml(value)}</td></tr>`

  const detailRows = [
    detailRow('Scene', opts.venue_name?.trim() || 'Ikke oppgitt'),
    detailRow('Adresse', opts.venue_address?.trim() || 'Ikke oppgitt'),
    detailRow('Dato', formatBookingDate(opts.show_date)),
    detailRow('Type spot', spotLabel),
    detailRow('Honorar', honorar),
  ].join('')

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: opts.email,
      subject,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;color:#18181b;line-height:1.55;max-width:540px">
          <h2 style="margin-bottom:4px">Hei ${escapeHtml(opts.full_name)}!</h2>
          <p>Du er nå booket hos ${escapeHtml(clubLabel)}.</p>

          <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px">
            ${detailRows}
          </table>

          <p>Vi gleder oss til å se deg på scenen! Møt opp 30 minutter før showstart.</p>
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

// ─────────────────────────────────────────────────────────────
// Spot available (reopened by admin removal)
// ─────────────────────────────────────────────────────────────
export async function sendSpotAvailableEmail(opts: {
  email: string
  full_name: string
  show_title: string
  show_date: string
  token: string
  response_url: string
}): Promise<EmailResult> {
  const subject = `Ledig spot: ${opts.show_title}`
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: opts.email,
      subject,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;color:#18181b;line-height:1.55">
          <h2>Hei ${escapeHtml(opts.full_name)}!</h2>
          <p>Vi har fått en ledig spot på <strong>${escapeHtml(opts.show_title)}</strong> den ${escapeHtml(opts.show_date)}.</p>
          <p style="margin:22px 0">
            <a href="${opts.response_url}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">Svar på tilbudet</a>
          </p>
          <p>Tilbudet er gyldig i 7 dager. Første artist som godkjenner mens plassen er ledig får spotten.</p>
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

// ─────────────────────────────────────────────────────────────
// Spot filled by other artist
// ─────────────────────────────────────────────────────────────
export async function sendSpotFilledEmail(opts: {
  email: string
  full_name: string
  club_name: string
  show_date: string
}): Promise<EmailResult> {
  const clubLabel = opts.club_name.trim()
  const dateLabel = formatBookingDate(opts.show_date)
  const subject = `Spotten er fylt hos ${clubLabel}`
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: opts.email,
      subject,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;color:#18181b;line-height:1.55;max-width:540px">
          <p>Hei ${escapeHtml(opts.full_name)},</p>
          <p>Beklager, en annen komiker har akseptert spotten hos ${escapeHtml(clubLabel)} den ${escapeHtml(dateLabel)}. Line-upen er dessverre full nå, men det vil forhåpentligvis være en ny mulighet om ikke så lenge.</p>
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

// ─────────────────────────────────────────────────────────────
// Ticket purchase confirmation
// ─────────────────────────────────────────────────────────────
export async function sendTicketPurchaseEmail(opts: {
  email: string
  buyer_name: string
  show_title: string
  show_date: string
  show_time?: string | null
  venue_name: string
  venue_address?: string | null
  ticket_code: string
  verification_url: string
}): Promise<EmailResult> {
  const subject = `Din billett til ${opts.show_title}`
  try {
    const qrImage = await QRCode.toBuffer(opts.verification_url, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
      color: {
        dark: '#111827',
        light: '#ffffff',
      },
    })

    const displayName = escapeHtml(opts.buyer_name || opts.email)
    const showTitle = escapeHtml(opts.show_title || 'humor.events')
    const showDate = escapeHtml(opts.show_date || 'Dato kommer')
    const showTime = escapeHtml(opts.show_time || 'Tid kommer')
    const venueName = escapeHtml(opts.venue_name || 'Sted kommer')
    const venueAddress = escapeHtml(opts.venue_address)
    const ticketCode = escapeHtml(opts.ticket_code)

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: opts.email,
      subject,
      attachments: [
        {
          filename: 'humor-events-ticket-qr.png',
          content: qrImage,
          contentType: 'image/png',
          contentId: 'ticket-qr',
        },
      ],
      text: `Hei ${opts.buyer_name || opts.email}\n\nTakk for kjøpet. Dette er billetten din til ${opts.show_title}.\n\nDato: ${opts.show_date}\nTid: ${opts.show_time ?? 'Tid kommer'}\nSted: ${opts.venue_name}${opts.venue_address ? `, ${opts.venue_address}` : ''}\nBillettkode: ${opts.ticket_code}\n\nVis QR-koden eller billettkoden i døren. QR-verifisering: ${opts.verification_url}\n`,
      html: `
        <div style="margin:0;background:#f4f4f5;padding:32px 12px;font-family:Inter,Arial,sans-serif;color:#18181b">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;overflow:hidden">
            <tr>
              <td style="background:#111827;color:#ffffff;padding:28px 30px">
                <div style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#a7f3d0;font-weight:700">humor.events</div>
                <h1 style="margin:10px 0 0;font-size:30px;line-height:1.1;font-weight:800">Din billett er klar</h1>
                <p style="margin:10px 0 0;color:#d1d5db;font-size:15px;line-height:1.5">Hei ${displayName}, betalingen er godkjent. Vis QR-koden i døren.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:30px">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align:top;padding-right:24px">
                      <div style="font-size:13px;color:#71717a;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Arrangement</div>
                      <h2 style="margin:8px 0 20px;font-size:26px;line-height:1.2;color:#18181b">${showTitle}</h2>
                      <div style="margin-bottom:14px">
                        <div style="font-size:12px;color:#71717a;font-weight:700;text-transform:uppercase;letter-spacing:0.06em">Dato</div>
                        <div style="font-size:17px;font-weight:700;color:#18181b">${showDate}</div>
                      </div>
                      <div style="margin-bottom:14px">
                        <div style="font-size:12px;color:#71717a;font-weight:700;text-transform:uppercase;letter-spacing:0.06em">Tid</div>
                        <div style="font-size:17px;font-weight:700;color:#18181b">${showTime}</div>
                      </div>
                      <div style="margin-bottom:18px">
                        <div style="font-size:12px;color:#71717a;font-weight:700;text-transform:uppercase;letter-spacing:0.06em">Sted</div>
                        <div style="font-size:17px;font-weight:700;color:#18181b">${venueName}</div>
                        ${venueAddress ? `<div style="font-size:14px;color:#52525b;margin-top:2px">${venueAddress}</div>` : ''}
                      </div>
                    </td>
                    <td style="width:190px;vertical-align:top;text-align:center">
                      <div style="display:inline-block;border:1px solid #e4e4e7;border-radius:14px;padding:12px;background:#ffffff">
                        <img src="cid:ticket-qr" width="166" height="166" alt="QR-kode for billett" style="display:block;border:0;width:166px;height:166px" />
                      </div>
                      <div style="font-size:11px;color:#71717a;margin-top:10px;line-height:1.4">Scan for å bekrefte billetten</div>
                    </td>
                  </tr>
                </table>

                <div style="margin-top:26px;border:1px dashed #a1a1aa;border-radius:14px;background:#fafafa;padding:18px;text-align:center">
                  <div style="font-size:12px;color:#71717a;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Billettkode</div>
                  <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:24px;line-height:1.2;font-weight:800;letter-spacing:0.08em;color:#111827;margin-top:6px;word-break:break-all">${ticketCode}</div>
                </div>

                <p style="margin:22px 0 0;color:#52525b;font-size:14px;line-height:1.6">QR-koden og billettkoden er personlige. Ta med denne e-posten til inngangen, så scanner vi billetten og bekrefter at den er gyldig.</p>
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
