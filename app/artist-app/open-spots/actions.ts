'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentArtist } from '@/lib/artist-portal'
import { assertArtistCanApply } from '@/lib/open-spots'

/**
 * Komikerens egne handlinger på en åpen plass.
 *
 * Alle tre henter artisten fra sesjonen i stedet for å ta imot en artist-id.
 * En handling som stolte på en id fra skjemaet ville latt hvem som helst
 * søke i andres navn.
 */

const OPEN_SPOTS = '/artist-app/open-spots'

/**
 * Ett klikk: søknaden legges inn på showet. Komikeren velger ikke plass —
 * det gjør klubben når den godkjenner.
 *
 * Er komikeren invitert til showet, merkes søknaden som det. Bookeren skal
 * kunne se forskjell på «meldte seg selv» og «vi spurte».
 *
 * Har komikeren trukket en søknad på showet før, åpnes den samme raden
 * igjen: én søknad per komiker per show, og den gamle har køplassen sin.
 */
export async function applyForShowAction(formData: FormData) {
  const showId = String(formData.get('show_id') ?? '')
  if (!showId) throw new Error('Missing show.')

  const { artist, db } = await getCurrentArtist()
  const { show } = await assertArtistCanApply(db, artist.id, showId)

  const { data: invitation } = await db
    .from('show_submission_invitations')
    .select('id')
    .eq('show_id', show.id)
    .eq('artist_id', artist.id)
    .maybeSingle()

  const { data: existing } = await db
    .from('show_submissions')
    .select('id, status')
    .eq('show_id', show.id)
    .eq('artist_id', artist.id)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'withdrawn') {
      const { error } = await db
        .from('show_submissions')
        .update({ status: 'pending', responded_at: null, show_requirement_id: null })
        .eq('id', existing.id)
        .eq('status', 'withdrawn')
      if (error) throw new Error(error.message)
      revalidateAfterApply(show.id)
    }
    redirect(`${OPEN_SPOTS}/${existing.id}`)
  }

  const { data: submission, error } = await db
    .from('show_submissions')
    .insert({
      show_id: show.id,
      artist_id: artist.id,
      source: invitation ? 'invitation' : 'open_call',
      invitation_id: invitation?.id ?? null,
    })
    .select('id')
    .single()

  if (error) {
    // Unik-constrainten på (show_id, artist_id). Å søke to ganger er ikke en
    // feil komikeren har gjort — det er som regel et dobbeltklikk.
    if (error.code === '23505') {
      const { data: raced } = await db
        .from('show_submissions')
        .select('id')
        .eq('show_id', show.id)
        .eq('artist_id', artist.id)
        .single()

      if (raced) redirect(`${OPEN_SPOTS}/${raced.id}`)
    }
    throw new Error(error.message)
  }

  revalidateAfterApply(show.id)
  redirect(`${OPEN_SPOTS}/${submission.id}`)
}

function revalidateAfterApply(showId: string) {
  revalidatePath(OPEN_SPOTS)
  revalidatePath(`/admin-app/shows/${showId}`)
}

/** Notatet til bookeren. Valgfritt, og kan endres til søknaden er behandlet. */
export async function updateSubmissionMessageAction(formData: FormData) {
  const submissionId = String(formData.get('submission_id') ?? '')
  const message = String(formData.get('message') ?? '').trim()

  const { artist, db } = await getCurrentArtist()

  const { data, error } = await db
    .from('show_submissions')
    .update({ message: message.length > 0 ? message.slice(0, 600) : null })
    .eq('id', submissionId)
    .eq('artist_id', artist.id)
    .in('status', ['pending', 'shortlisted'])
    .select('id')

  if (error) throw new Error(error.message)
  if (!data?.length) {
    throw new Error('This application has already been handled, so the note cannot be changed.')
  }

  revalidatePath(`${OPEN_SPOTS}/${submissionId}`)
}

/**
 * Komikeren trekker søknaden.
 *
 * Raden blir stående som `withdrawn` i stedet for å slettes: bookeren kan ha
 * sett den, og en rad som forsvinner uten spor er verre enn en som sier hva
 * som skjedde.
 */
export async function withdrawSubmissionAction(formData: FormData) {
  const submissionId = String(formData.get('submission_id') ?? '')
  const { artist, db } = await getCurrentArtist()

  const { data, error } = await db
    .from('show_submissions')
    .update({ status: 'withdrawn', responded_at: new Date().toISOString() })
    .eq('id', submissionId)
    .eq('artist_id', artist.id)
    .in('status', ['pending', 'shortlisted'])
    .select('show_id')

  if (error) throw new Error(error.message)
  if (!data?.length) {
    throw new Error('This application has already been handled and cannot be withdrawn.')
  }

  revalidatePath(OPEN_SPOTS)
  revalidatePath(`/admin-app/shows/${data[0].show_id}`)
  redirect(OPEN_SPOTS)
}
