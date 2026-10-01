import { NextResponse } from 'next/server'
import { headshotToken, judgeHeadshot } from '@/lib/headshot-check'
import type { HeadshotVerdict } from '@/lib/headshot-guide'
import { MAX_UPLOAD_BYTES } from '@/lib/image-compress'

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Registreringsskjemaet sender headshotet hit idet komikeren velger det.
 * Svaret er enten en kvittering skjemaet sender med, eller grunnen til at
 * bildet ble avvist — se `lib/headshot-check.ts`.
 */
export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null)
  const photo = formData?.get('photo')

  if (!(photo instanceof File) || photo.size === 0 || photo.size > MAX_UPLOAD_BYTES || !ACCEPTED_TYPES.has(photo.type)) {
    return NextResponse.json({ error: 'invalid_photo' }, { status: 400 })
  }

  const image = Buffer.from(await photo.arrayBuffer())
  const verdict = await judgeHeadshot(image)

  const body: HeadshotVerdict = verdict.approved
    ? { approved: true, token: headshotToken(image) }
    : verdict

  return NextResponse.json(body)
}
