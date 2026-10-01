/**
 * Sosiale lenker: komikeren skriver brukernavnet, vi lagrer lenken.
 *
 * Skjemaene ba om hele URL-en, og det var tungvint på mobil. Nå holder det å
 * skrive «@tomsoyler» — eller lime inn lenken, den forstås også. I
 * `social_links` lagres fortsatt full URL, for den brukes som `href` på
 * komikersiden og i admin.
 *
 * Bare http(s) slipper gjennom. Feltene var fritekst på serveren før, og en
 * `javascript:`-«lenke» havnet rett i en `href`.
 *
 * Ingen Node-avhengigheter: skjemaet bruker `socialHandle` til å fylle inn.
 */

export type SocialNetwork = 'instagram' | 'tiktok' | 'facebook'

type NetworkRule = {
  domains: string[]
  profileUrl: (handle: string) => string
  /** Første ledd i stien, hvis det er et brukernavn. */
  handleFromSegment: (segment: string) => string | null
}

const HANDLE = /^[A-Za-z0-9._]{1,64}$/

const plainHandle = (segment: string) => (HANDLE.test(segment) ? segment : null)

const NETWORKS: Record<SocialNetwork, NetworkRule> = {
  instagram: {
    domains: ['instagram.com', 'instagr.am'],
    profileUrl: (handle) => `https://www.instagram.com/${handle}`,
    handleFromSegment: (segment) => (['p', 'reel', 'reels', 'stories', 'explore'].includes(segment) ? null : plainHandle(segment)),
  },
  tiktok: {
    domains: ['tiktok.com'],
    profileUrl: (handle) => `https://www.tiktok.com/@${handle}`,
    // Profiler ligger under /@navn. Alt annet (videoer, korte vm.-lenker) er ikke en profil.
    handleFromSegment: (segment) => (segment.startsWith('@') ? plainHandle(segment.slice(1)) : null),
  },
  facebook: {
    domains: ['facebook.com', 'fb.com'],
    profileUrl: (handle) => `https://www.facebook.com/${handle}`,
    handleFromSegment: (segment) => (['profile.php', 'people', 'pages', 'groups', 'share'].includes(segment) ? null : plainHandle(segment)),
  },
}

function parseHttpUrl(text: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

function belongsTo(url: URL, rule: NetworkRule) {
  const host = url.hostname.toLowerCase()
  return rule.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/**
 * Det komikeren skrev → lenken som lagres. `@navn`, `navn`, `instagram.com/navn`
 * og hele lenker gir samme svar. En lenke til nettverket som ikke er en profil
 * (Facebook-sider med id, korte TikTok-lenker) lagres som den er. Tomt eller
 * ugyldig gir `undefined`.
 */
export function socialProfileUrl(network: SocialNetwork, input: string | null | undefined): string | undefined {
  const text = input?.trim()
  if (!text || /\s/.test(text)) return undefined
  const rule = NETWORKS[network]

  const looksLikeUrl = /^https?:\/\//i.test(text) || rule.domains.some((domain) => text.toLowerCase().includes(`${domain}/`))
  if (looksLikeUrl) {
    const url = parseHttpUrl(text)
    if (!url) return undefined
    if (!belongsTo(url, rule)) return url.toString()
    const segment = url.pathname.split('/').filter(Boolean)[0] ?? ''
    const handle = rule.handleFromSegment(decodeURIComponent(segment))
    return handle ? rule.profileUrl(handle) : url.toString()
  }

  const handle = plainHandle(text.replace(/^@+/, ''))
  return handle ? rule.profileUrl(handle) : undefined
}

/** Den lagrede lenken → det som står i feltet. Brukernavnet når vi finner det, ellers lenken. */
export function socialHandle(network: SocialNetwork, stored: string | null | undefined): string {
  if (!stored) return ''
  const url = parseHttpUrl(stored)
  const rule = NETWORKS[network]
  if (!url || !belongsTo(url, rule)) return stored
  const segment = url.pathname.split('/').filter(Boolean)[0] ?? ''
  return rule.handleFromSegment(decodeURIComponent(segment)) ?? stored
}

/** «tomsoyler.no» er godt nok — https:// legges på. Må ha et domene med punktum. */
export function websiteUrl(input: string | null | undefined): string | undefined {
  const text = input?.trim()
  if (!text || /\s/.test(text)) return undefined
  const url = parseHttpUrl(text)
  return url && url.hostname.includes('.') ? url.toString() : undefined
}

/** `social_links` fra et skjema med feltene instagram, tiktok, facebook, website og showcase. */
export function socialLinksFromForm(formData: FormData): Record<string, string> | null {
  const text = (name: string) => String(formData.get(name) ?? '')
  const links = {
    instagram: socialProfileUrl('instagram', text('instagram')),
    tiktok: socialProfileUrl('tiktok', text('tiktok')),
    showcase: text('showcase').trim() || undefined,
    facebook: socialProfileUrl('facebook', text('facebook')),
    website: websiteUrl(text('website')),
  }
  const entries = Object.entries(links).filter((entry): entry is [string, string] => Boolean(entry[1]))
  return entries.length > 0 ? Object.fromEntries(entries) : null
}
