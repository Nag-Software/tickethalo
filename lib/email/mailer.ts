import { resend, FROM_EMAIL } from '@/lib/resend'
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
        <h2>Hei ${opts.full_name}!</h2>
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
          <h2>Gratulerer, ${opts.full_name}!</h2>
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
  club_name?: string | null
  venue?: string | null
  fee_amount?: number | null   // stored in øre/cents
  currency?: string | null
  token: string
  response_url: string
}): Promise<EmailResult> {
  const subject = `Bookingtilbud: ${opts.show_title}`

  const feeFormatted = opts.fee_amount
    ? `${Math.round(opts.fee_amount / 100).toLocaleString('nb-NO')} ${opts.currency ?? 'NOK'}`
    : null

  const detailRows = [
    opts.club_name  ? `<tr><td style="color:#71717a;padding:6px 0;width:110px">Klubb</td><td style="padding:6px 0;font-weight:500">${escapeHtml(opts.club_name)}</td></tr>` : '',
    opts.venue      ? `<tr><td style="color:#71717a;padding:6px 0">Sted</td><td style="padding:6px 0;font-weight:500">${escapeHtml(opts.venue)}</td></tr>` : '',
    opts.show_date  ? `<tr><td style="color:#71717a;padding:6px 0">Dato</td><td style="padding:6px 0;font-weight:500">${escapeHtml(opts.show_date)}</td></tr>` : '',
    opts.show_start_time ? `<tr><td style="color:#71717a;padding:6px 0">Showstart</td><td style="padding:6px 0;font-weight:500">${escapeHtml(opts.show_start_time.slice(0, 5))}</td></tr>` : '',
    feeFormatted    ? `<tr><td style="color:#71717a;padding:6px 0">Honorar</td><td style="padding:6px 0;font-weight:500">${escapeHtml(feeFormatted)}</td></tr>` : '',
  ].join('')

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: opts.email,
      subject,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;color:#18181b;line-height:1.55;max-width:540px">
          <h2 style="margin-bottom:4px">Hei ${escapeHtml(opts.full_name)}!</h2>
          <p>Du har mottatt et bookingtilbud for <strong>${escapeHtml(opts.show_title)}</strong>.</p>

          <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px">
            ${detailRows}
          </table>

          <p style="margin:22px 0">
            <a href="${opts.response_url}?response=accept" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px;margin-right:8px">Ja, jeg kan</a>
            <a href="${opts.response_url}?response=decline" style="display:inline-block;border:1px solid #d4d4d8;color:#18181b;text-decoration:none;padding:9px 14px;border-radius:8px">Nei, denne passer ikke</a>
          </p>
          <div style="border:1px solid #f59e0b;background:#fffbeb;border-radius:10px;padding:14px;margin:18px 0;color:#78350f">
            <p style="margin:0 0 8px"><strong>Viktig:</strong> Godkjenn kun datoer som passer. Du vil fortsatt få tilbud i fremtiden selv om disse ikke passer.</p>
            <p style="margin:0">Hvis du derimot velger ja på en line-up og etterpå dropper, blir profilen din flagget og systemet vil nedprioritere å gi deg tilbud om nye spots når de blir ledige.</p>
          </div>
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
// Booking confirmed
// ─────────────────────────────────────────────────────────────
export async function sendBookingConfirmedEmail(opts: {
  email: string
  full_name: string
  show_title: string
  show_date: string
}): Promise<EmailResult> {
  const subject = `Booking bekreftet: ${opts.show_title}`
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: opts.email,
      subject,
      html: `
        <h2>Din booking er bekreftet!</h2>
        <p>Hei ${opts.full_name}, du er booket til <strong>${opts.show_title}</strong> den ${opts.show_date}.</p>
        <p>Logg inn på artistportalen for detaljer.</p>
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
          <h2>Hei ${opts.full_name}!</h2>
          <p>Vi har fått en ledig spot på <strong>${opts.show_title}</strong> den ${opts.show_date}.</p>
          <p style="margin:22px 0">
            <a href="${opts.response_url}?response=accept" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px;margin-right:8px">Ja, jeg er interessert</a>
            <a href="${opts.response_url}?response=decline" style="display:inline-block;border:1px solid #d4d4d8;color:#18181b;text-decoration:none;padding:9px 14px;border-radius:8px">Nei, denne passer ikke</a>
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
}): Promise<EmailResult> {
  const subject = 'Beklager — plassen er allerede fylt'
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: opts.email,
      subject,
      html: `
        <p>Hei ${opts.full_name},</p>
        <p>Dessverre ble plassen fylt av en annen artist før du svarte. Vi holder deg oppdatert om nye muligheter.</p>
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
