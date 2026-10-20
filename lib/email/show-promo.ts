/**
 * «Send e-mail about show» — e-posten klubben sender til lista si.
 *
 * Ren funksjon, ingen utsending: forhåndsvisningen i markedsføringsfanen og
 * utsendingen i `sendShowEmailAction` bygger den samme e-posten, så det
 * klubben ser er det publikum får. Det eneste som skiller er
 * avmeldingslenken, som er personlig.
 *
 * Avsenderen er klubben (`fromWithName`), ikke Tickethalo: det er klubbens
 * liste og klubbens show. Derfor er det klubbens navn som står øverst, og
 * Tickethalo bare nevnt i bunnen.
 */
import { EMAIL_PALETTE, escapeHtml, type EmailTemplate } from './templates'

const { BG, CARD, LINE, INK, MUTED, ACCENT } = EMAIL_PALETTE

export type ShowPromoEmailInput = {
  clubName: string
  subject: string
  /** Klubbens tekst, slik den står i tekstfeltet. Tom linje = nytt avsnitt. */
  body: string
  showTitle: string
  posterUrl: string | null
  /** Den offentlige showsiden. */
  ticketUrl: string
  /** Mottakerens egen avmeldingsside. Null i forhåndsvisningen. */
  unsubscribeUrl: string | null
}

/** Adresser i teksten blir lenker. Kjøres etter escapeHtml, så `&` er `&amp;`. */
function linkify(escaped: string) {
  return escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (url) => (
    `<a href="${url}" style="color:${INK};text-decoration:underline">${url}</a>`
  ))
}

/** Avsnitt av tomme linjer, linjeskift av enkle. */
export function bodyToHtml(body: string) {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((line) => linkify(escapeHtml(line.trim())))
      return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK}">${lines.join('<br />')}</p>`
    })
    .join('\n')
}

export function showPromoEmail(input: ShowPromoEmailInput): EmailTemplate {
  const club = escapeHtml(input.clubName)
  const unsubscribeHref = escapeHtml(input.unsubscribeUrl ?? '#')
  const ticketHref = escapeHtml(input.ticketUrl)

  const poster = input.posterUrl
    ? `<tr><td style="padding:0"><img src="${escapeHtml(input.posterUrl)}" alt="${escapeHtml(input.showTitle)}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:14px 14px 0 0" /></td></tr>`
    : ''

  const html = `
    <div style="margin:0;background:${BG};padding:32px 12px;font-family:Inter,Helvetica,Arial,sans-serif;color:${INK}">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto">
        <tr>
          <td style="padding:0 4px 14px">
            <div style="font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT}">${club}</div>
          </td>
        </tr>
        <tr>
          <td style="background:${CARD};border:1px solid ${LINE};border-radius:14px;padding:0">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              ${poster}
              <tr>
                <td style="padding:30px">
                  <h1 style="margin:0 0 18px;font-size:27px;line-height:1.12;letter-spacing:-0.02em;font-weight:700;color:${INK}">${escapeHtml(input.showTitle)}</h1>
                  ${bodyToHtml(input.body)}
                  <div style="margin:24px 0 0"><a href="${ticketHref}" style="display:inline-block;background:${INK};color:${BG};border:1px solid ${INK};text-decoration:none;padding:13px 22px;border-radius:999px;font-size:15px;font-weight:600">Get tickets</a></div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 4px 0;font-size:12px;line-height:1.6;color:${MUTED}">
            You are getting this email because you signed up for emails from ${club}.
            <a href="${unsubscribeHref}" style="color:${MUTED};text-decoration:underline">Unsubscribe</a><br />
            Sent with Tickethalo.
          </td>
        </tr>
      </table>
    </div>`

  const text = [
    input.showTitle,
    '',
    input.body.trim(),
    '',
    `Get tickets: ${input.ticketUrl}`,
    '',
    '—',
    `You are getting this email because you signed up for emails from ${input.clubName}.`,
    input.unsubscribeUrl ? `Unsubscribe: ${input.unsubscribeUrl}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n')

  return { subject: input.subject, html, text }
}
