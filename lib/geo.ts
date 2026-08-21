/**
 * Place lookup and distance maths for the location picker.
 *
 * Clubs store a plain `city` string and nothing else — no coordinates. So to
 * answer "which shows are nearest to me" we resolve that string against the
 * table below and measure from there. A show is therefore located to its
 * city, not its venue: good enough to rank Bergen above Trondheim, and
 * deliberately not precise enough to rank two venues within one city.
 *
 * Pure and client-safe — no Supabase, no server imports. The picker is a
 * client component and needs all of this in the browser.
 */

export interface Coordinates {
  lat: number
  lon: number
}

export interface Place extends Coordinates {
  /** Spelt the way the city is written on a club record. */
  name: string
  /** Shown as the second line in the picker, to separate the several Osloer of this world. */
  region: string
}

/**
 * Norwegian towns that plausibly host a stand-up night, largest first-ish.
 *
 * Two jobs: resolving a club's city to coordinates, and offering somewhere to
 * pick when we have no shows there yet — picking an empty city lands the user
 * on the "get notified" form, which is the whole point of listing them.
 *
 * Coordinates are the town centre to about three decimals (~100 m), which is
 * far finer than the city-level ranking needs.
 */
export const PLACES: Place[] = [
  { name: 'Oslo', region: 'Oslo', lat: 59.9139, lon: 10.7522 },
  { name: 'Bergen', region: 'Vestland', lat: 60.3913, lon: 5.3221 },
  { name: 'Trondheim', region: 'Trøndelag', lat: 63.4305, lon: 10.3951 },
  { name: 'Stavanger', region: 'Rogaland', lat: 58.97, lon: 5.7331 },
  { name: 'Sandnes', region: 'Rogaland', lat: 58.8524, lon: 5.7352 },
  { name: 'Drammen', region: 'Buskerud', lat: 59.7439, lon: 10.2045 },
  { name: 'Kristiansand', region: 'Agder', lat: 58.1467, lon: 7.9956 },
  { name: 'Fredrikstad', region: 'Østfold', lat: 59.2181, lon: 10.9298 },
  { name: 'Sarpsborg', region: 'Østfold', lat: 59.2839, lon: 11.1096 },
  { name: 'Tromsø', region: 'Troms', lat: 69.6492, lon: 18.9553 },
  { name: 'Skien', region: 'Telemark', lat: 59.2096, lon: 9.609 },
  { name: 'Porsgrunn', region: 'Telemark', lat: 59.1408, lon: 9.6561 },
  { name: 'Ålesund', region: 'Møre og Romsdal', lat: 62.4722, lon: 6.1549 },
  { name: 'Sandefjord', region: 'Vestfold', lat: 59.1313, lon: 10.2166 },
  { name: 'Tønsberg', region: 'Vestfold', lat: 59.2674, lon: 10.4076 },
  { name: 'Haugesund', region: 'Rogaland', lat: 59.4136, lon: 5.268 },
  { name: 'Moss', region: 'Østfold', lat: 59.434, lon: 10.6577 },
  { name: 'Bodø', region: 'Nordland', lat: 67.2804, lon: 14.4049 },
  { name: 'Arendal', region: 'Agder', lat: 58.4616, lon: 8.7724 },
  { name: 'Hamar', region: 'Innlandet', lat: 60.7945, lon: 11.068 },
  { name: 'Larvik', region: 'Vestfold', lat: 59.0533, lon: 10.0294 },
  { name: 'Halden', region: 'Østfold', lat: 59.133, lon: 11.3875 },
  { name: 'Lillehammer', region: 'Innlandet', lat: 61.1153, lon: 10.4662 },
  { name: 'Gjøvik', region: 'Innlandet', lat: 60.7957, lon: 10.6915 },
  { name: 'Molde', region: 'Møre og Romsdal', lat: 62.7375, lon: 7.1591 },
  { name: 'Kristiansund', region: 'Møre og Romsdal', lat: 63.1105, lon: 7.728 },
  { name: 'Harstad', region: 'Troms', lat: 68.7986, lon: 16.5415 },
  { name: 'Narvik', region: 'Nordland', lat: 68.4385, lon: 17.4272 },
  { name: 'Mo i Rana', region: 'Nordland', lat: 66.3128, lon: 14.1428 },
  { name: 'Alta', region: 'Finnmark', lat: 69.9689, lon: 23.2717 },
  { name: 'Hammerfest', region: 'Finnmark', lat: 70.6634, lon: 23.6821 },
  { name: 'Kirkenes', region: 'Finnmark', lat: 69.7273, lon: 30.045 },
  { name: 'Lillestrøm', region: 'Akershus', lat: 59.9558, lon: 11.049 },
  { name: 'Sandvika', region: 'Akershus', lat: 59.8908, lon: 10.5266 },
  { name: 'Asker', region: 'Akershus', lat: 59.8331, lon: 10.4392 },
  { name: 'Ski', region: 'Akershus', lat: 59.7195, lon: 10.8355 },
  { name: 'Jessheim', region: 'Akershus', lat: 60.1408, lon: 11.1747 },
  { name: 'Drøbak', region: 'Akershus', lat: 59.6636, lon: 10.6297 },
  { name: 'Hønefoss', region: 'Buskerud', lat: 60.1683, lon: 10.2578 },
  { name: 'Kongsberg', region: 'Buskerud', lat: 59.6686, lon: 9.6503 },
  { name: 'Horten', region: 'Vestfold', lat: 59.4171, lon: 10.4833 },
  { name: 'Holmestrand', region: 'Vestfold', lat: 59.4894, lon: 10.3138 },
  { name: 'Kongsvinger', region: 'Innlandet', lat: 60.1903, lon: 12.0004 },
  { name: 'Elverum', region: 'Innlandet', lat: 60.8819, lon: 11.5623 },
  { name: 'Røros', region: 'Trøndelag', lat: 62.5747, lon: 11.3843 },
  { name: 'Stjørdal', region: 'Trøndelag', lat: 63.47, lon: 10.92 },
  { name: 'Steinkjer', region: 'Trøndelag', lat: 64.0148, lon: 11.4954 },
  { name: 'Levanger', region: 'Trøndelag', lat: 63.7465, lon: 11.2996 },
  { name: 'Namsos', region: 'Trøndelag', lat: 64.4661, lon: 11.4958 },
  { name: 'Orkanger', region: 'Trøndelag', lat: 63.3003, lon: 9.848 },
  { name: 'Voss', region: 'Vestland', lat: 60.6294, lon: 6.4147 },
  { name: 'Førde', region: 'Vestland', lat: 61.4522, lon: 5.857 },
  { name: 'Florø', region: 'Vestland', lat: 61.5996, lon: 5.0328 },
  { name: 'Sogndal', region: 'Vestland', lat: 61.2308, lon: 7.1005 },
  { name: 'Leirvik', region: 'Vestland', lat: 59.7817, lon: 5.5 },
  { name: 'Odda', region: 'Vestland', lat: 60.07, lon: 6.546 },
  { name: 'Straume', region: 'Vestland', lat: 60.36, lon: 5.12 },
  { name: 'Bryne', region: 'Rogaland', lat: 58.7355, lon: 5.6485 },
  { name: 'Egersund', region: 'Rogaland', lat: 58.4515, lon: 5.9998 },
  { name: 'Jørpeland', region: 'Rogaland', lat: 59.0217, lon: 6.0453 },
  { name: 'Kopervik', region: 'Rogaland', lat: 59.279, lon: 5.307 },
  { name: 'Sauda', region: 'Rogaland', lat: 59.6503, lon: 6.3536 },
  { name: 'Mandal', region: 'Agder', lat: 58.0294, lon: 7.4609 },
  { name: 'Grimstad', region: 'Agder', lat: 58.3405, lon: 8.5934 },
  { name: 'Lillesand', region: 'Agder', lat: 58.2497, lon: 8.3771 },
  { name: 'Flekkefjord', region: 'Agder', lat: 58.2969, lon: 6.6614 },
  { name: 'Farsund', region: 'Agder', lat: 58.0947, lon: 6.8046 },
  { name: 'Lyngdal', region: 'Agder', lat: 58.1385, lon: 7.0728 },
  { name: 'Kragerø', region: 'Telemark', lat: 58.8688, lon: 9.4111 },
  { name: 'Risør', region: 'Agder', lat: 58.7207, lon: 9.234 },
  { name: 'Notodden', region: 'Telemark', lat: 59.559, lon: 9.2586 },
  { name: 'Fauske', region: 'Nordland', lat: 67.2597, lon: 15.3928 },
  { name: 'Svolvær', region: 'Nordland', lat: 68.2342, lon: 14.568 },
  { name: 'Leknes', region: 'Nordland', lat: 68.1479, lon: 13.611 },
  { name: 'Sortland', region: 'Nordland', lat: 68.6961, lon: 15.4139 },
  { name: 'Mosjøen', region: 'Nordland', lat: 65.837, lon: 13.192 },
  { name: 'Sandnessjøen', region: 'Nordland', lat: 66.0217, lon: 12.6318 },
  { name: 'Brønnøysund', region: 'Nordland', lat: 65.4747, lon: 12.2119 },
  { name: 'Finnsnes', region: 'Troms', lat: 69.23, lon: 17.98 },
  { name: 'Vadsø', region: 'Finnmark', lat: 70.0744, lon: 29.7487 },
]

/**
 * Casefold a place name for matching: lowercase, no diacritics.
 *
 * `æ` and `ø` are single code points with no NFD decomposition, so they are
 * mapped by hand before normalising — `å` and friends fall out of NFD on
 * their own. This is what lets someone type "tromso" and reach "Tromsø",
 * which is how people actually type on a phone.
 */
export function foldName(value: string): string {
  return value
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

const PLACES_BY_FOLDED_NAME = new Map(PLACES.map((place) => [foldName(place.name), place]))

/** Resolves a club's `city` string to a known place, or undefined if we do not have it. */
export function lookupPlace(city: string | null | undefined): Place | undefined {
  if (!city) return undefined
  return PLACES_BY_FOLDED_NAME.get(foldName(city))
}

const EARTH_RADIUS_KM = 6371

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

/**
 * Great-circle distance in kilometres.
 *
 * Haversine treats the Earth as a sphere, which is off by up to ~0.5% against
 * the real ellipsoid. Over Norway that is a few hundred metres on a Oslo–Tromsø
 * measurement, and we are only using this to sort a list.
 */
export function haversineKm(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.lat - from.lat)
  const dLon = toRadians(to.lon - from.lon)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** The known place closest to a coordinate — how a raw GPS fix becomes "Bergen". */
export function nearestPlace(coords: Coordinates, places: Place[] = PLACES): Place | undefined {
  let best: Place | undefined
  let bestKm = Infinity
  for (const place of places) {
    const km = haversineKm(coords, place)
    if (km < bestKm) {
      bestKm = km
      best = place
    }
  }
  return best
}

/**
 * Distance from a coordinate to a club's city, or null when the city is
 * missing or unknown. Callers sort unknowns last rather than guessing at zero.
 */
export function distanceToCity(from: Coordinates, city: string | null | undefined): number | null {
  const place = lookupPlace(city)
  return place ? haversineKm(from, place) : null
}

/**
 * "600 m", "12 km", "180 km" — precision drops as the number grows, because
 * nobody reading a show list cares that Tromsø is 1 617.4 km away.
 */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 100) * 10} m`
  if (km < 10) return `${km.toFixed(1)} km`
  return `${Math.round(km)} km`
}

/**
 * Search places by name, prefix matches first.
 *
 * A plain substring sort would put "Sandnessjøen" above "Sandnes" for the
 * query "sandnes" often enough to be annoying, so the two tiers are ranked
 * separately and only then by name length.
 */
export function searchPlaces(query: string, places: Place[] = PLACES, limit = 8): Place[] {
  const needle = foldName(query)
  if (!needle) return []

  const prefix: Place[] = []
  const contains: Place[] = []
  for (const place of places) {
    const name = foldName(place.name)
    if (name.startsWith(needle)) prefix.push(place)
    else if (name.includes(needle)) contains.push(place)
  }

  const byLength = (a: Place, b: Place) => a.name.length - b.name.length
  return [...prefix.sort(byLength), ...contains.sort(byLength)].slice(0, limit)
}
