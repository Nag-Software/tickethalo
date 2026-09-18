import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenAI } from '@/lib/openai'
import { MARKETING_DESIGN_BUCKET } from '@/lib/marketing/storage'
import { generateBackground } from '@/lib/poster/background'
import { builtinPosterLayout, posterSeed } from '@/lib/poster/builtin'
import { renderPoster, type PosterArtist, type PosterContent, type RenderedPoster } from '@/lib/poster/compose'
import { builtInTitle, sameTitle, type PosterLayout } from '@/lib/poster/layout'
import { ensureTemplateReady, resetTemplateSetup, templatePosterLooksGood, type TemplateRecord } from '@/lib/poster/template-setup'
import type { MarketingPalette, PosterLineupSnapshot } from '@/types/database'

/**
 * Lager showets plakat.
 *
 * Bildemodellen tegner bare bakgrunnen. Ansikter, navn, dato og sted settes av
 * `renderPoster`, fra de samme radene i databasen som resten av systemet
 * bruker. Med en klubbmal er bakgrunnen malens egen, tømte plate; AI-en brukes
 * da bare til å sette opp malen første gang og til å se over resultatet.
 *
 * Hver plakat som lages blir en rad i arkivet (`show_marketing_designs`,
 * `kind: 'poster'`). `shows.poster_url` peker på den gjeldende, men ingen
 * plakat overskrives eller slettes av at en ny blir laget.
 */

export type PosterArtistInput = {
  id: string | null
  name: string
  imageUrl: string | null
  roleName: string | null
}

export type PosterTemplateInput = TemplateRecord & { platePath?: string | null }

export type GeneratePosterOptions = {
  clubId: string | null
  title: string
  date: string
  startTime?: string | null
  venue: string
  artists: PosterArtistInput[]
  template?: PosterTemplateInput | null
  palette: MarketingPalette
  /** Bakgrunnen showet allerede har, og stien den ligger på. */
  existingBackground?: { url: string | null; path: string | null }
  /** Lag ny bakgrunn selv om showet har en fra før. */
  newBackground?: boolean
  throwOnError?: boolean
}

export const POSTER_FOOTER = 'Billetter · Tickethalo'

function isHeadlinerRole(roleName: string | null) {
  const normalized = roleName?.toLowerCase() ?? ''
  return normalized.includes('headliner') || normalized.includes('headline') || normalized.includes('hoved')
}

export function formatPosterDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'short' }).format(date)
}

/** Samme navn to ganger i lineupen er én artist, ikke to ruter. */
function uniqueArtists(artists: PosterArtistInput[]): PosterArtistInput[] {
  const seen = new Set<string>()
  return artists.filter((artist) => {
    const key = artist.id ?? artist.name.toLowerCase().trim()
    if (!artist.name.trim() || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return null
    if (!(response.headers.get('content-type') ?? 'image/').startsWith('image/')) return null
    return Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }
}

async function loadArtistPhoto(artist: PosterArtistInput): Promise<Buffer | null> {
  if (!artist.imageUrl) return null
  const raw = await fetchImage(artist.imageUrl)
  if (!raw) {
    console.warn(`[Poster] Could not fetch the photo for ${artist.name}; the name is used without it.`)
    return null
  }
  try {
    return await sharp(raw, { animated: false })
      .rotate()
      .toColorspace('srgb')
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
  } catch (error) {
    console.warn(`[Poster] The photo for ${artist.name} could not be read:`, error)
    return null
  }
}

/** Kort fingeravtrykk av paletten — en bakgrunn i gamle farger gjenbrukes ikke. */
function paletteKey(palette: MarketingPalette): string {
  return posterSeed(`${palette.primary}${palette.secondary}${palette.accent}`).toString(36)
}

export async function preparePosterContent(opts: Pick<GeneratePosterOptions, 'title' | 'date' | 'startTime' | 'venue' | 'artists'>): Promise<PosterContent> {
  const ranked = uniqueArtists(opts.artists)
  const ordered = [...ranked.filter((a) => isHeadlinerRole(a.roleName)), ...ranked.filter((a) => !isHeadlinerRole(a.roleName))]

  const artists: PosterArtist[] = await Promise.all(ordered.map(async (artist) => ({
    id: artist.id,
    name: artist.name.trim(),
    photo: await loadArtistPhoto(artist),
    isHeadliner: isHeadlinerRole(artist.roleName),
  })))

  return {
    title: opts.title,
    dateText: formatPosterDate(opts.date),
    timeText: opts.startTime ? `kl. ${opts.startTime.slice(0, 5)}` : '',
    venue: opts.venue,
    footer: POSTER_FOOTER,
    artists,
  }
}

export function builtinLayoutFor(showId: string, content: PosterContent, palette: MarketingPalette): PosterLayout {
  return builtinPosterLayout({
    // De innebygde layoutene har ikke noe lineupfelt, så alle får rute.
    framedCount: content.artists.length,
    headlinerCount: content.artists.filter((artist) => artist.isHeadliner).length,
    palette,
    seed: posterSeed(showId),
  })
}

export async function generateShowPoster(showId: string, opts: GeneratePosterOptions): Promise<string | null> {
  const db = createAdminClient()

  try {
    const content = await preparePosterContent(opts)
    if (content.artists.length === 0) throw new Error('There are no confirmed artists to put on the poster yet.')

    // Med mal: malen settes opp av seg selv første gang, plakaten rendres, og
    // resultatet kontrolleres. Går noe av det galt — for få ruter, en tittel
    // som ikke stemmer, et resultat som ikke ser bra ut — lages plakaten i
    // innebygd layout i klubbens farger i stedet. Klubben får alltid en plakat
    // som er riktig, og malen brukes bare når den også blir pen.
    let rendered: RenderedPoster | null = null
    let canvas = { width: 1024, height: 1536 }
    if (opts.template) {
      try {
        const openai = getOpenAI()
        const ready = await ensureTemplateReady(db, openai, opts.template)

        const designTitle = builtInTitle(ready.layout)
        if (designTitle && !sameTitle(designTitle, opts.title)) {
          throw new Error(`the design carries the title "${designTitle}", but the show is called "${opts.title}"`)
        }

        const attempt = await renderPoster({ layout: ready.layout, content, background: ready.plate })

        // En rute uten navnefelt gir et ansikt uten navn. Det er ikke en
        // smakssak, så det avgjøres her og ikke av kvalitetskontrollen.
        const unnamed = attempt.plan.placements.find((placement) => !placement.nameBox)
        if (unnamed) {
          await resetTemplateSetup(db, opts.template.id, opts.template.platePath ?? null)
          throw new Error(`the template has no name field for ${unnamed.artist.name}`)
        }
        const verdict = await templatePosterLooksGood(openai, attempt.buffer)
        if (!verdict.ok) {
          // Et oppsett som ga et dårlig resultat skal ikke bli liggende: neste
          // forsøk starter på nytt i stedet for å gjenta samme feil.
          await resetTemplateSetup(db, opts.template.id, opts.template.platePath ?? null)
          throw new Error(`quality check: ${verdict.reason || 'layout problem'}`)
        }
        rendered = attempt
        canvas = ready.layout.canvas
      } catch (error) {
        console.warn(`[Poster] Template "${opts.template.label ?? opts.template.id}" not used, falling back to the built-in layout:`, error)
      }
    }

    let newBackground: { url: string; path: string } | null = null
    if (!rendered) {
      const layout = builtinLayoutFor(showId, content, opts.palette)
      let background: Buffer

      const key = paletteKey(opts.palette)
      const reusable = !opts.newBackground
        && opts.existingBackground?.url
        && opts.existingBackground.path?.includes(`-${key}-`)
      const existing = reusable ? await fetchImage(opts.existingBackground!.url!) : null

      if (existing) {
        background = existing
      } else {
        const seed = posterSeed(showId) + (opts.newBackground ? Date.now() % 1000 : 0)
        const generated = await generateBackground(getOpenAI(), opts.palette, seed)
        background = generated.buffer

        const path = `${showId}/backgrounds/bg-${key}-${Date.now()}.png`
        const { error } = await db.storage
          .from(MARKETING_DESIGN_BUCKET)
          .upload(path, background, { contentType: 'image/png', upsert: false })
        // En bakgrunn som ikke lot seg lagre er ikke verdt å stoppe for: den
        // genereres bare på nytt neste gang.
        if (!error) {
          newBackground = { url: db.storage.from(MARKETING_DESIGN_BUCKET).getPublicUrl(path).data.publicUrl, path }
        }
      }
      rendered = await renderPoster({ layout, content, background })
      canvas = layout.canvas
    }

    const { buffer, plan } = rendered

    const filePath = `${showId}/posters/poster-${Date.now()}.png`
    const { error: uploadError } = await db.storage
      .from(MARKETING_DESIGN_BUCKET)
      .upload(filePath, buffer, { contentType: 'image/png', upsert: false })
    if (uploadError) throw new Error(`Could not save the poster: ${uploadError.message}`)

    const { data: { publicUrl } } = db.storage.from(MARKETING_DESIGN_BUCKET).getPublicUrl(filePath)

    const lineup: PosterLineupSnapshot = [...plan.placements.map((p) => p.artist), ...plan.listed]
      .map((artist) => ({ artist_id: artist.id, name: artist.name }))

    const { error: archiveError } = await db.from('show_marketing_designs').insert({
      show_id: showId,
      club_id: opts.clubId,
      kind: 'poster',
      source: 'ai',
      lineup_snapshot: lineup,
      label: `${opts.title} — ${new Intl.DateTimeFormat('nb-NO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`,
      file_url: publicUrl,
      file_path: filePath,
      file_name: filePath.split('/').pop()!,
      mime_type: 'image/png',
      file_type: 'image',
      file_size: buffer.length,
      width: canvas.width,
      height: canvas.height,
    })
    // Arkivraden er hele poenget med at plakater ikke forsvinner. Uten den er
    // fila foreldreløs, så den ryddes bort og feilen går videre.
    if (archiveError) {
      await db.storage.from(MARKETING_DESIGN_BUCKET).remove([filePath])
      throw new Error(`Could not save the poster to the archive: ${archiveError.message}`)
    }

    const { error: updateError } = await db
      .from('shows')
      .update({
        poster_url: publicUrl,
        poster_source: 'ai',
        ...(newBackground ? { poster_background_url: newBackground.url, poster_background_path: newBackground.path } : {}),
      })
      .eq('id', showId)
    if (updateError) throw new Error(`Could not set the poster on the show: ${updateError.message}`)

    // Den forrige bakgrunnen er bakt inn i plakatene som brukte den, og trengs
    // ikke lenger som egen fil.
    if (newBackground && opts.existingBackground?.path) {
      await db.storage.from(MARKETING_DESIGN_BUCKET).remove([opts.existingBackground.path])
    }

    return publicUrl
  } catch (error) {
    console.error('[Poster] Generation failed:', error)
    if (opts.throwOnError) {
      if (error instanceof Error) throw error
      throw new Error('Could not generate the poster right now.')
    }
    return null
  }
}
