'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentArtist } from '@/lib/artist-portal'
import { osloDateString } from '@/lib/booking-schedule'
import { lookupCountry } from '@/lib/geo'
import { normalizeLanguages } from '@/lib/languages'

export async function updateArtistProfileAction(formData: FormData) {
  const { artist, db } = await getCurrentArtist()
  const imageFile = formData.get('profile_image_file')
  let profileImageUrl = artist.profile_image_url

  if (imageFile instanceof File && imageFile.size > 0) {
    const ext = imageFile.name.split('.').pop() ?? 'jpg'
    const path = `${artist.auth_user_id ?? artist.id}/profile.${ext}`
    const { error } = await db.storage.from('artist-images').upload(path, imageFile, { upsert: true })
    if (error) throw new Error('The profile image could not be uploaded right now.')
    const { data } = db.storage.from('artist-images').getPublicUrl(path)
    profileImageUrl = data.publicUrl
  }

  const socialLinks = socialLinksFromForm(formData)
  const languageValues = normalizeLanguages(formData.getAll('language').map((value) => String(value)))

  // `category` settes bevisst ikke her. Rollen avgjør hvilke show komikeren
  // matches mot, så den eies av klubben i admin — ikke av komikeren selv.
  // Feltet utelates fra update-objektet, ikke bare fra skjemaet, slik at en
  // POST med `category` heller ikke kan sette den.
  await db.from('artists').update({
    full_name: textValue(formData.get('full_name')) ?? artist.full_name,
    stage_name: textValue(formData.get('stage_name')) ?? null,
    phone: textValue(formData.get('phone')) ?? null,
    bank_account_number: textValue(formData.get('bank_account_number')) ?? null,
    profile_image_url: profileImageUrl,
    bio: textValue(formData.get('bio')) ?? null,
    city: textValue(formData.get('city')) ?? null,
    country: countryValue(formData.get('country')),
    languages: languageValues.length > 0 ? languageValues : null,
    social_links: socialLinks,
  }).eq('id', artist.id)

  revalidatePath('/artist-app/profile')
}

export type SaveUnavailableDatesResult =
  | {
      ok: true
      /** Datoene som faktisk ble lagret. Kan være færre enn det som ble sendt. */
      added: string[]
      removed: string[]
      /** Noe gikk delvis galt, men det som står i svaret er lagret. */
      warning?: string
    }
  | { error: string }
  /**
   * Dagene komikeren er i ferd med å markere, der det ligger et ubesvart
   * tilbud. Å markere dagen er i praksis et nei — det skal hen få si ja til
   * selv, ikke oppdage etterpå.
   */
  | { needsConfirm: string[] }

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Så mange datoer kan én lagring gjelde. Nok til et halvår, ikke nok til å spamme. */
const MAX_DATES_PER_SAVE = 200

/** Avviser både feil form og datoer som ikke finnes, som 30. februar. */
function validDates(dates: string[] | undefined): string[] {
  return [...new Set((dates ?? []).filter((date) => {
    if (!DATE_PATTERN.test(date)) return false
    const parsed = new Date(`${date}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
  }))]
}

/**
 * Lagrer dagene komikeren ikke kan.
 *
 * Kalenderen lagrer fortløpende og sender bare det som er endret. Svaret sier
 * hvilke datoer som faktisk ble lagret, ikke bare at det gikk bra: serveren
 * kan forkaste en dato som har vært, og uten at den sier fra ville
 * kalenderen stått og vist en markering som ikke finnes noe sted.
 *
 * Rekkefølgen er lagre først, avslå etterpå. Feiler et avslag, står dagen
 * markert med et tilbud som fortsatt lever — det kan komikeren rydde opp i
 * selv. Motsatt rekkefølge ville mistet en booking og latt kalenderen se
 * urørt ut.
 */
export async function saveUnavailableDatesAction(input: {
  add?: string[]
  remove?: string[]
  /** Datoene komikeren har bekreftet at et ubesvart tilbud kan avslås på. */
  declineOffersOn?: string[]
}): Promise<SaveUnavailableDatesResult> {
  const { artist, db } = await getCurrentArtist()

  // Norsk tid, som resten av bookingen. `toISOString()` ville gitt UTC, og
  // en komiker vest for oss ville fått dagen sin forkastet som «passert».
  const today = osloDateString()

  const add = validDates(input.add).filter((date) => date >= today)
  const remove = validDates(input.remove)
  const confirmedFor = new Set(validDates(input.declineOffersOn))

  if (add.length + remove.length > MAX_DATES_PER_SAVE) {
    return { error: `You can change at most ${MAX_DATES_PER_SAVE} days at a time.` }
  }
  if (add.length === 0 && remove.length === 0) return { ok: true, added: [], removed: [] }

  let warning: string | undefined
  let offersToDecline: Array<{ token: string }> = []

  if (add.length > 0) {
    const { data: showsOnDates, error: showError } = await db
      .from('shows')
      .select('id, date')
      .in('date', add)
      .is('deleted_at', null)

    // Feiler dette, vet vi ikke om dagene er booket eller har tilbud ute.
    // Da skal ingenting lagres: en sperre som svarer «ingen treff» når den
    // ikke når fram, er ingen sperre.
    if (showError) return { error: 'The dates could not be saved right now. Try again.' }

    const showIds = (showsOnDates ?? []).map((show) => show.id)
    const dateByShow = new Map((showsOnDates ?? []).map((show) => [show.id, show.date]))

    if (showIds.length > 0) {
      const [{ data: booked, error: bookedError }, { data: offers, error: offersError }] = await Promise.all([
        db.from('confirmed_spots')
          .select('show_id')
          .eq('artist_id', artist.id)
          .in('show_id', showIds)
          .in('status', ['confirmed', 'completed', 'paid']),
        db.from('booking_offers')
          .select('token, show_id')
          .eq('artist_id', artist.id)
          .in('show_id', showIds)
          .eq('status', 'sent'),
      ])

      if (bookedError || offersError) {
        return { error: 'The dates could not be saved right now. Try again.' }
      }

      const bookedDates = [...new Set((booked ?? []).flatMap((spot) => dateByShow.get(spot.show_id) ?? []))]
      if (bookedDates.length > 0) {
        return {
          error: bookedDates.length === 1
            ? `You are booked on ${bookedDates[0]}. Get in touch with the club to change it.`
            : `You are booked on ${bookedDates.join(', ')}. Get in touch with the club to change those.`,
        }
      }

      const pending = offers ?? []
      const pendingDates = [...new Set(pending.flatMap((offer) => dateByShow.get(offer.show_id) ?? []))]

      // Bekreftelsen gjelder de datoene komikeren faktisk fikk se. Kommer et
      // nytt tilbud inn mens dialogen står åpen, spør vi på nytt i stedet for
      // å avslå noe hen aldri ble vist.
      if (pendingDates.some((date) => !confirmedFor.has(date))) {
        return { needsConfirm: pendingDates }
      }

      offersToDecline = pending.map((offer) => ({ token: offer.token }))
    }

    const { error } = await db
      .from('artist_unavailable_dates')
      .upsert(
        add.map((date) => ({ artist_id: artist.id, unavailable_date: date })),
        { onConflict: 'artist_id,unavailable_date', ignoreDuplicates: true },
      )

    if (error) return { error: 'The dates could not be saved right now. Try again.' }
  }

  if (remove.length > 0) {
    const { error } = await db
      .from('artist_unavailable_dates')
      .delete()
      .eq('artist_id', artist.id)
      .in('unavailable_date', remove)

    if (error) return { error: 'The dates could not be saved right now. Try again.' }
  }

  // Gjennom den vanlige nei-flyten: kvittering på e-post til komikeren, og
  // motoren tilbyr plassen videre med en gang. Ett avslag som feiler skal
  // ikke velte de andre, eller dagene som allerede er lagret.
  if (offersToDecline.length > 0) {
    const { declineBookingOffer } = await import('@/lib/actions/booking')
    let failed = 0

    for (const offer of offersToDecline) {
      try {
        await declineBookingOffer(offer.token)
      } catch (error) {
        failed++
        console.error('[Availability] Could not decline offer while marking a date:', error)
      }
    }

    if (failed > 0) {
      warning = failed === 1
        ? 'The day is marked, but one offer could not be turned down. Please decline it from your bookings.'
        : `The days are marked, but ${failed} offers could not be turned down. Please decline them from your bookings.`
    }
  }

  revalidatePath('/artist-app/availability')
  return { ok: true, added: add, removed: remove, ...(warning ? { warning } : {}) }
}

export async function acceptOfferAction(formData: FormData) {
  const { artist, db } = await getCurrentArtist()
  const token = textValue(formData.get('token'))
  if (!token) throw new Error('Bookingtilbudet mangler token.')

  const { data: offer } = await db
    .from('booking_offers')
    .select('artist_id')
    .eq('token', token)
    .single()

  if (!offer || offer.artist_id !== artist.id) redirect('/artist-app/booking-offers?status=denied')

  const { acceptBookingOffer } = await import('@/lib/actions/booking')
  const result = await acceptBookingOffer(token)
  redirect(`/artist-app/booking-offers?status=${result.result}`)
}

export async function declineOfferAction(formData: FormData) {
  const { artist, db } = await getCurrentArtist()
  const token = textValue(formData.get('token'))
  if (!token) throw new Error('Bookingtilbudet mangler token.')

  const { data: offer } = await db
    .from('booking_offers')
    .select('artist_id')
    .eq('token', token)
    .single()

  if (!offer || offer.artist_id !== artist.id) redirect('/artist-app/booking-offers?status=denied')

  const { declineBookingOffer } = await import('@/lib/actions/booking')
  await declineBookingOffer(token)
  redirect('/artist-app/booking-offers?status=declined')
}

function textValue(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : undefined
}

/** Ukjente landkoder lagres ikke — kolonnen skal ikke bli fritekst igjen. */
function countryValue(value: FormDataEntryValue | null) {
  const text = textValue(value)?.toUpperCase()
  return text && lookupCountry(text) ? text : null
}

function socialLinksFromForm(formData: FormData) {
  const links = {
    instagram: textValue(formData.get('instagram')),
    tiktok: textValue(formData.get('tiktok')),
    showcase: textValue(formData.get('showcase')),
    facebook: textValue(formData.get('facebook')),
    website: textValue(formData.get('website')),
  }
  const entries = Object.entries(links).filter((entry): entry is [string, string] => Boolean(entry[1]))
  return entries.length > 0 ? Object.fromEntries(entries) : null
}