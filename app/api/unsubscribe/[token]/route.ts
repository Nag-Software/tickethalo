import { NextResponse } from 'next/server'
import { setUnsubscribed } from '@/lib/marketing/unsubscribe-db'

/**
 * One-click-avmelding (RFC 8058), adressen i `List-Unsubscribe`.
 *
 * Gmail og Apple Mail viser sin egen «Unsubscribe» og sender
 * `List-Unsubscribe=One-Click` som POST hit. Ingen side, ingen bekreftelse —
 * det er hele poenget. GET melder ikke av: skannere åpner lenker, men sender
 * ikke POST. En GET sendes videre til siden med knappen.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ok = await setUnsubscribed(token, true)
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 })
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return NextResponse.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}`, request.url), 303)
}
