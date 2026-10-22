import { appPath } from '@/lib/app-url'
import { lineupDetailRows, type LineupShowDetails } from '@/lib/lineup-communication'
import {
  button,
  details,
  escapeHtml,
  note,
  paragraph,
  shell,
  showDateLabel,
  type EmailTemplate,
} from './templates'

/**
 * E-postene fra Communication-fanen: meldingen klubben skriver, påminnelsen
 * 5 dager før og invitasjonen til gruppechatten. Rene funksjoner, som
 * resten av malene; utsendingen står i lib/lineup-messages.ts.
 *
 * Hver e-post lenker til meldingen i portalen, der den også ligger.
 */

export function lineupThreadUrl(showId: string) {
  return appPath(`/artist-app/messages/${showId}`)
}

/** Klubbens tekst: avsnitt ved tomme linjer, linjeskift beholdt, alt escapet. */
export function messageParagraphs(body: string) {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => paragraph(escapeHtml(block).replace(/\n/g, '<br />')))
    .join('')
}

export function lineupMessageSubject(showTitle: string, clubName: string) {
  return `${showTitle}: message from ${clubName}`
}

export function lineupMessageTemplate(opts: {
  recipientName: string
  clubName: string
  senderName: string | null
  showId: string
  showTitle: string
  showDate: string
  body: string
}): EmailTemplate {
  const from = opts.senderName ? `${opts.senderName}, ${opts.clubName}` : opts.clubName
  const url = lineupThreadUrl(opts.showId)
  return {
    subject: lineupMessageSubject(opts.showTitle, opts.clubName),
    text: `Hi ${opts.recipientName}\n\n${opts.body.trim()}\n\n— ${from}\n\n${opts.showTitle}, ${showDateLabel(opts.showDate)}\nReply to this email to answer. All messages about the show: ${url}`,
    html: shell({
      eyebrow: `Message from ${opts.clubName}`,
      heading: opts.showTitle,
      body:
        paragraph(`${escapeHtml(showDateLabel(opts.showDate))}`, true) +
        paragraph(`Hi ${escapeHtml(opts.recipientName)},`) +
        messageParagraphs(opts.body) +
        paragraph(`— ${escapeHtml(from)}`, true) +
        note('Reply to this email', `to answer ${opts.senderName ?? opts.clubName}.`) +
        button(url, 'See all messages about the show', 'ghost'),
    }),
  }
}

export function reminderSubject(showTitle: string, showDate: string) {
  return `Reminder: ${showTitle} on ${showDateLabel(showDate)}`
}

function daysLeftLabel(daysLeft: number) {
  return daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`
}

/**
 * Teksten i portalen. E-posten er personlig (rolle, honorar, «You are
 * hosting»); i innboksen står den felles delen.
 */
export function reminderBody(details: LineupShowDetails) {
  return [
    `A reminder that you are on the line-up for ${details.title}.`,
    '',
    ...lineupDetailRows(details).map(([label, value]) => `${label}: ${value}`),
    ...(details.groupLink ? ['', `Group chat: ${details.groupLink}`] : []),
  ].join('\n')
}

export function lineupReminderTemplate(opts: {
  recipientName: string
  artistId: string
  showId: string
  details: LineupShowDetails
  daysLeft: number
  roleName: string | null
  feeLabel: string | null
}): EmailTemplate {
  const rows: Array<[string, string | null]> = [
    ...lineupDetailRows(opts.details, opts.artistId),
    ['Your spot', opts.roleName],
    ['Fee', opts.feeLabel],
  ]
  const url = lineupThreadUrl(opts.showId)
  const when = daysLeftLabel(opts.daysLeft)
  const textRows = rows.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`)

  return {
    subject: reminderSubject(opts.details.title, opts.details.date),
    text: [
      `Hi ${opts.recipientName}`,
      '',
      `${opts.details.title} is ${when}, and you are on the line-up.`,
      '',
      ...textRows,
      ...(opts.details.groupLink ? ['', `Join the group chat: ${opts.details.groupLink}`] : []),
      '',
      `Something come up? Reply to this email to tell ${opts.details.clubName}.`,
      `Messages about the show: ${url}`,
    ].join('\n'),
    html: shell({
      eyebrow: `Reminder from ${opts.details.clubName}`,
      heading: `Your show is ${when}`,
      body:
        paragraph(`Hi ${escapeHtml(opts.recipientName)}, you are on the line-up for <strong>${escapeHtml(opts.details.title)}</strong>.`) +
        details(rows) +
        (opts.details.groupLink ? button(opts.details.groupLink, 'Join the group chat') : '') +
        paragraph(`Something come up? Reply to this email to tell ${escapeHtml(opts.details.clubName)}.`, true) +
        button(url, 'See messages about the show', 'ghost'),
    }),
  }
}

export function groupInviteSubject(showTitle: string) {
  return `Join the group chat for ${showTitle}`
}

export function groupInviteBody(showTitle: string, link: string) {
  return `Here is the WhatsApp group for ${showTitle}. Join to get the latest from the club and the rest of the line-up:\n${link}`
}

export function lineupGroupInviteTemplate(opts: {
  recipientName: string
  clubName: string
  showId: string
  showTitle: string
  showDate: string
  link: string
}): EmailTemplate {
  const url = lineupThreadUrl(opts.showId)
  return {
    subject: groupInviteSubject(opts.showTitle),
    text: `Hi ${opts.recipientName}\n\n${groupInviteBody(opts.showTitle, opts.link)}\n\n${opts.showTitle}, ${showDateLabel(opts.showDate)}\nMessages about the show: ${url}`,
    html: shell({
      eyebrow: `From ${opts.clubName}`,
      heading: 'Join the group chat',
      body:
        paragraph(`Hi ${escapeHtml(opts.recipientName)}, here is the WhatsApp group for <strong>${escapeHtml(opts.showTitle)}</strong> on ${escapeHtml(showDateLabel(opts.showDate))}. Join to get the latest from the club and the rest of the line-up.`) +
        button(opts.link, 'Join the group chat') +
        paragraph('The link opens WhatsApp. Everyone in the group can see your number.', true) +
        button(url, 'See messages about the show', 'ghost'),
    }),
  }
}
