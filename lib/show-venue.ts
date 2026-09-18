/**
 * Hvor showet er — én leseregel for alle flater.
 *
 * `shows` har `venue_name` og `venue_address`, og de ble lest på fem ulike
 * måter: navn ellers adresse, adresse ellers navn, bare navn, begge med komma,
 * og tilbudssiden som viste «Coming» når navnet manglet selv om adressen sto
 * rett under. Eldre show har bare adresselinja (skjemaet hadde ett felt), så
 * regelen må tåle at navnet mangler.
 *
 *  - `venue` er det som står ved «Venue»: navnet, ellers adressen.
 *  - `address` er adressen som egen linje — bare når den sier noe mer enn
 *    `venue` allerede gjør.
 *  - `line` er begge på én linje, til e-post, plakat og lister.
 *
 * Ingen Node-avhengigheter: både server og klient bruker den.
 */

export type VenueFields = {
  venue_name?: string | null
  venue_address?: string | null
}

export type ShowVenue = {
  venue: string | null
  address: string | null
  line: string | null
}

const clean = (value: string | null | undefined) => value?.trim() || null

export function showVenue(show: VenueFields | null | undefined): ShowVenue {
  const name = clean(show?.venue_name)
  const addressLine = clean(show?.venue_address)

  const venue = name ?? addressLine
  const address = name && addressLine && name.toLowerCase() !== addressLine.toLowerCase() ? addressLine : null

  return { venue, address, line: [venue, address].filter(Boolean).join(', ') || null }
}

// ─────────────────────────────────────────────────────────────
// Velgeren i show-skjemaet
// ─────────────────────────────────────────────────────────────

export type VenueLocation = { id: string; name: string; address_line: string | null }

/** Det show-skjemaet sender inn: teksten slik den står, og lenken hvis den gjelder. */
export type VenueSelection = {
  venue_name: string
  venue_address: string
  club_location_id: string | null
}

const fold = (value: string | null | undefined) => (value ?? '').trim().toLowerCase()

/** Søk på navn og adresse samtidig. Tomt søk gir alle, i klubbens egen rekkefølge. */
export function searchLocations<T extends VenueLocation>(locations: T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return locations
  return locations.filter((location) => {
    const haystack = `${fold(location.name)} ${fold(location.address_line)}`
    return words.every((word) => haystack.includes(word))
  })
}

/**
 * Lenken gjelder bare så lenge teksten er lokasjonens egen. Retter bookeren
 * navnet eller adressen for hånd på showet, er det ikke lenger den lagrede
 * lokasjonen — og da skal en senere endring under My club ikke skrive over det
 * bookeren skrev.
 */
export function isLinkedTo(selection: Pick<VenueSelection, 'venue_name' | 'venue_address'>, location: VenueLocation) {
  return fold(selection.venue_name) === fold(location.name) && fold(selection.venue_address) === fold(location.address_line)
}

/** Skrevet tekst som treffer en lagret lokasjon på navn, lenkes til den. */
export function locationByName<T extends VenueLocation>(locations: T[], name: string): T | null {
  const wanted = fold(name)
  if (!wanted) return null
  return locations.find((location) => fold(location.name) === wanted) ?? null
}

// ─────────────────────────────────────────────────────────────
// Det som faktisk lagres
// ─────────────────────────────────────────────────────────────

/**
 * Avgjør hva showet skal lagre, gitt det skjemaet sendte og klubbens
 * lokasjoner. Ren funksjon — databasen er kallstedets sak.
 *
 *  1. En oppgitt lenke gjelder bare hvis lokasjonen er klubbens egen OG
 *     teksten fortsatt er lokasjonens (se `isLinkedTo`). En id fra en annen
 *     klubb finnes ikke i lista og faller dermed bort av seg selv.
 *  2. Uten lenke: et navn som er skrevet likt en lagret lokasjon lenkes til
 *     den, så lenge adressen ikke sier noe annet. Bookeren som skriver
 *     «Backstage» for hånd skal få samme resultat som den som velger den.
 *  3. Ellers er det fritekst — et sted klubben ikke har lagret.
 *
 * En lenket rad lagres med lokasjonens egen skrivemåte, så «backstage» og
 * «Backstage» ikke blir to steder i listene.
 */
export function resolveVenueSelection(selection: VenueSelection, locations: VenueLocation[]): {
  venue_name: string | null
  venue_address: string | null
  club_location_id: string | null
} {
  const name = selection.venue_name.trim()
  const address = selection.venue_address.trim()

  const chosen = selection.club_location_id
    ? locations.find((location) => location.id === selection.club_location_id) ?? null
    : null

  const byName = locationByName(locations, name)
  const typedMatch = byName && (!address || fold(address) === fold(byName.address_line)) ? byName : null

  const linked = chosen && isLinkedTo({ venue_name: name, venue_address: address }, chosen) ? chosen : typedMatch

  if (linked) {
    return { venue_name: linked.name, venue_address: clean(linked.address_line), club_location_id: linked.id }
  }

  return { venue_name: name || null, venue_address: address || null, club_location_id: null }
}

/** « · Backstage» til listerader som «17. okt · 20:15 · Backstage». Tom streng uten sted. */
export function venueSuffix(show: VenueFields | null | undefined, separator = ' · ') {
  const { venue } = showVenue(show)
  return venue ? `${separator}${venue}` : ''
}
