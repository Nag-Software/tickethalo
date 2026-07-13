// NOT a 'use server' module — deliberately. generateShowPoster drives
// service-role writes (poster upload, brand-kit cache) from caller-supplied
// pointers, so it must never be a directly invokable server-action endpoint.
// The only entry points are the access-checked server actions that import it
// (app/admin-app/shows/actions.ts generatePosterAction — assertShowAccess —
// and lib/actions/booking.ts automateFullbookedShow, system-invoked).

import { toFile, type Uploadable } from 'openai'
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenAI } from '@/lib/openai'
import { POSTER_FONT_FAMILY, ensurePosterFonts } from '@/lib/poster-fonts'
import { escapeSvgText, type PosterArtist } from '@/lib/poster-compose'
import { patchLogosFromReference } from '@/lib/poster-logo-patch'
import type { PosterDesignTemplate } from '@/lib/poster-assets'

type PosterArtistInput = string | {
  name: string
  profile_image_url?: string | null
  role_name?: string | null
}

type PosterDesignTemplateInput = PosterDesignTemplate

type PosterReferencePhoto = {
  artist: PosterArtist & { profileImageUrl: string }
  buffer: Buffer
  file: Uploadable
}

type PosterReferencePackage = {
  images: Uploadable[]
  identityLines: string[]
}

type PosterPromptContext = {
  sorted: PosterArtist[]
  headliners: PosterArtist[]
  supporting: PosterArtist[]
  mode: 'reference' | 'free'
  title: string
  dateLine: string
  venue: string
  posterPlan: ReturnType<typeof createPosterPlan> | null
  identityMapIndex: number
  artistReferenceStartIndex: number
  artistReferenceEndIndex: number
  referencePackage: PosterReferencePackage
  changeRequest: string | null
  referenceSource: 'show' | 'club' | null
}

/**
 * The complete poster brief — the model renders the FINISHED poster including
 * all text. Two modes:
 *
 * 'reference': images.edit against the club's reference poster. The design is
 * treated as a locked template — only people and event-specific text change.
 * This is what keeps the club's identity across shows.
 *
 * 'free': images.generate from a seeded design plan (stableHash keeps briefs
 * consistent per show across regenerations).
 *
 * Text correctness strategy: every string the model must render is given
 * EXACTLY once, in quotes, in a single TEXT manifest — models copy quoted
 * strings far more reliably than strings buried in prose. Everything not in
 * the manifest is forbidden.
 */
function buildPosterPrompt(ctx: PosterPromptContext): string {
  const {
    sorted,
    headliners,
    supporting,
    mode,
    title,
    dateLine,
    venue,
    posterPlan,
    identityMapIndex,
    artistReferenceStartIndex,
    artistReferenceEndIndex,
    referencePackage,
    changeRequest,
    referenceSource,
  } = ctx

  const artistCount = sorted.length
  const headlinerNames = headliners.map(a => a.name).join(' og ')
  const photoCount = referencePackage.identityLines.length

  // Comedians without a photo still get a slot + name — but never an
  // invented realistic face.
  const photoless = photoCount > 0 && photoCount < artistCount
    ? sorted.filter((artist) => !artist.profileImageUrl).map((artist) => artist.name)
    : []
  const photolessRule = photoless.length > 0
    ? `- ${photoless.length === 1 ? 'One comedian has' : `${photoless.length} comedians have`} no photo (${photoless.map((name) => `"${name}"`).join(', ')}): give ${photoless.length === 1 ? 'them' : 'each'} a stylized silhouette or graphic mark in ${photoless.length === 1 ? 'their' : 'their'} slot — NEVER an invented realistic face — with the name displayed like the others.`
    : null

  // ── TEXT MANIFEST — the single source of truth for every rendered string ──
  const nameLines = sorted.map((artist) => `  - "${artist.name}"`)
  const textManifest = [
    `TEXT MANIFEST — render EXACTLY these strings and nothing else (plus any static brand text the reference design already carries):`,
    `- Title (largest text): "${title}"`,
    `- Date line: "${dateLine}"`,
    venue ? `- Venue: "${venue}"` : null,
    `- One name per comedian, next to/under their portrait:`,
    ...nameLines,
    ``,
    `TEXT RENDERING RULES (highest priority of the whole brief):`,
    `- Copy each quoted string letter by letter. Norwegian characters æ, ø, å, Æ, Ø, Å must be exact.`,
    `- Every string appears in exactly ONE place on the poster. Never repeat the title, the date line or the venue — one occurrence each, total.`,
    `- Do NOT invent any other text: no slogans, no "billetter", no URLs, no fake sponsor names, no lorem ipsum, no gibberish glyphs${mode === 'reference' ? ' — except static brand text that is already part of the reference design, which stays exactly as it is' : ''}.`,
    `- Typography must be clean, straight, high-contrast and legible at thumbnail size — professional print quality, never warped, smudged or half-formed letters.`,
    `- If a text area is too small for a string, make the text smaller or rearrange — never truncate or misspell.`,
  ].filter(Boolean)

  // ── IDENTITY — real faces, correct name under the correct face ──
  const identityBlock = photoCount > 0
    ? [
      `COMEDIAN IDENTITY (input images):`,
      `- Input image ${identityMapIndex} is an IDENTITY MAP: numbered headshots with names. It is a lookup table only — NEVER reproduce the grid, its numbers or its labels in the poster.`,
      `- Input images ${artistReferenceStartIndex}–${artistReferenceEndIndex} are the comedians' individual photos, in the same numbered order:`,
      ...referencePackage.identityLines.map((line) => `  ${line}`),
      `- Reproduce each face photo-realistically and faithfully: geometry, skin tone, hair, glasses, beard, expression, age. No beautifying, caricature, merging or identity swaps.`,
      `- The name under/next to each portrait MUST be that person's name from the list above — never another comedian's.`,
      headliners.length > 0 && supporting.length > 0
        ? `- Hierarchy: headliner${headliners.length > 1 ? 's' : ''} ${headlinerNames} visibly larger/more prominent; supporting acts equal to each other.`
        : `- All ${artistCount} comedians get equal visual weight.`,
    ]
    : [
      `COMEDIAN IDENTITY:`,
      `- No photos are supplied. Do NOT fabricate faces — use silhouettes, stage lighting, microphone or graphic elements instead of portraits.`,
      `- Names from the TEXT MANIFEST still appear as text.`,
    ]

  const changeRequestBlock = changeRequest
    ? [
      ``,
      `USER CHANGE REQUEST for this regeneration (apply visibly, but never break the text manifest or identity rules):`,
      `- ${changeRequest}`,
    ]
    : []

  if (mode === 'reference') {
    return [
      `TASK: Create THIS WEEK'S poster in an established comedy club's poster series.`,
      `Input image 1 is the club's ${referenceSource === 'club' ? 'standard reference poster — their visual identity across all shows' : 'chosen reference poster for this show'}.`,
      ``,
      `THE REFERENCE IS A LOCKED TEMPLATE. A returning guest must instantly recognize it as the same club's poster:`,
      `- KEEP identical: page layout and composition, background, color palette, textures, decorative graphics, frame/border styles, and all static brand text (club name, slogans, taglines, website lines) — same wording, same position, same lettering style. Copy brand text character for character, INCLUDING special characters like ø, Ø, æ, å — never latinize them.`,
      `- LOGOS ARE UNTOUCHABLE: copy every logo and brand mark from the reference stroke for stroke, INCLUDING any text inside them, letter by letter (e.g. a bar or sponsor logo keeps its exact name). Never re-typeset, redraw, restyle or "improve" a logo. A slightly soft but faithful copy beats a sharp re-lettered one.`,
      `- REPLACE the people: the reference's portraits are swapped for this show's ${artistCount} comedian${artistCount === 1 ? '' : 's'} (see COMEDIAN IDENTITY).`,
      `- REPLACE event-specific text: old title/date/venue/names are replaced by the TEXT MANIFEST strings, set in the same typographic style and positions the reference uses for the equivalent text.`,
      `- This is a STRICT TEMPLATE EDIT, not a redesign: every design element (bands, panels, splashes, bars) stays at its reference position and size. Do not add new sections, do not repeat a section, do not move the title/date area.`,
      ``,
      `PORTRAIT LAYOUT:`,
      `- The show has exactly ${artistCount} comedian${artistCount === 1 ? '' : 's'}. If the reference design has a different number of portrait slots, REDESIGN the portrait area to exactly ${artistCount} portrait${artistCount === 1 ? '' : 's'} — same frame style, borders, proportions and rhythm, rebalanced to fill the area harmoniously.`,
      `- NEVER leave empty frames, placeholder boxes or blank portrait slots.`,
      `- Portraits are integrated in the reference's photo treatment (its color grading, its framing style).`,
      ...(photolessRule ? [photolessRule] : []),
      ...changeRequestBlock,
      ``,
      ...textManifest,
      ``,
      ...identityBlock,
      ``,
      `QUALITY BAR:`,
      `- Output looks like the same graphic designer made one more poster in the series — not an AI pastiche of it.`,
      `- Print-ready 2:3 portrait. No watermarks, no mockup frames, no extra borders.`,
      `- No background people, no invented faces, no malformed hands/faces.`,
    ].join('\n')
  }

  return [
    `TASK: Design a complete, finished Norwegian stand-up comedy poster (2:3 portrait) — professional club/venue quality.`,
    `You are a senior poster designer. The poster must sell tickets from an Instagram feed and read clearly as a thumbnail.`,
    ``,
    `DESIGN BRIEF (seeded for this show — keep regenerations in this direction):`,
    posterPlan ? `- Concept: ${posterPlan.concept}` : null,
    posterPlan ? `- Composition: ${posterPlan.composition}` : null,
    posterPlan ? `- Photo treatment: ${posterPlan.photoTreatment}` : null,
    posterPlan ? `- Palette: ${posterPlan.palette}` : null,
    posterPlan ? `- Texture: ${posterPlan.texture}` : null,
    `- One clear focal point, generous negative space, strong contrast — no clutter, no generic AI gloss.`,
    `- Credible against professional Norwegian comedy posters (Latter, Stand Up Norge) — not a movie poster, not a stock ad.`,
    artistCount === 1
      ? `- Solo show: one large portrait carries the poster.`
      : `- Ensemble: ${artistCount} clear portraits — one per comedian, arranged in a deliberate grid or composition.`,
    ...(photolessRule ? [photolessRule] : []),
    ...changeRequestBlock,
    ``,
    ...textManifest,
    ``,
    ...identityBlock,
    ``,
    `QUALITY BAR:`,
    `- Title is the loudest element; date and venue are unmissable at a glance.`,
    `- Print-ready. No watermarks, no mockup frames.`,
    `- No background people, no invented faces, no malformed hands/faces.`,
  ].filter(Boolean).join('\n')
}

export async function generateShowPoster(showId: string, opts: {
  title: string
  date: string
  startTime?: string | null
  venue: string
  artists: PosterArtistInput[]
  /** «Bruk referanseplakat» — when false the reference is ignored. */
  useReference: boolean
  aiReference?: PosterDesignTemplate | null
  aiReferenceSource?: 'show' | 'club' | null
  changeRequest?: string | null
  throwOnError?: boolean
}): Promise<string | null> {
  const admin = createAdminClient()

  try {
    const artists = normalizePosterArtists(opts.artists)
    const headliners = artists.filter(a => isHeadlinerRole(a.roleName))
    const supporting = artists.filter(a => !isHeadlinerRole(a.roleName))
    const sorted = [...headliners, ...supporting]
    const changeRequest = normalizeChangeRequest(opts.changeRequest)

    const dateText = formatPosterDate(opts.date)
    const timeText = opts.startTime ? `kl. ${opts.startTime.slice(0, 5)}` : ''
    const venue = opts.venue || 'humor.events'

    const dateLine = timeText ? `${dateText} · ${timeText}` : dateText
    const reference = opts.useReference ? opts.aiReference ?? null : null

    const poster = await generatePosterImage({
      showId,
      title: opts.title,
      date: opts.date,
      dateLine,
      venue,
      sorted,
      headliners,
      supporting,
      reference,
      referenceSource: opts.aiReferenceSource ?? (reference?.source === 'club_default' ? 'club' : reference ? 'show' : null),
      changeRequest,
    })

    return await uploadGeneratedPoster(admin, showId, poster)
  } catch (err) {
    console.error('[Poster] Generation failed:', err)
    if (opts.throwOnError) {
      if (err instanceof Error) throw err
      throw new Error('Kunne ikke generere plakat akkurat nå.')
    }
    return null
  }
}

/**
 * The pure generation step: build the prompt + input images and ask
 * gpt-image-1.5 for the FINISHED poster (all text included). Exported
 * separately from generateShowPoster so it can be exercised without
 * touching storage or the show row.
 */
export async function generatePosterImage(input: {
  showId: string
  title: string
  date: string
  dateLine: string
  venue: string
  sorted: PosterArtist[]
  headliners: PosterArtist[]
  supporting: PosterArtist[]
  reference: PosterDesignTemplate | null
  referenceSource: 'show' | 'club' | null
  changeRequest: string | null
}): Promise<Buffer> {
  const { sorted, reference } = input

  // The identity map is rendered with sharp/SVG text — without the bundled
  // fonts registered it comes out as tofu on Vercel/Lambda.
  ensurePosterFonts()

  // With a reference the poster is an EDIT of it (locked template semantics);
  // without one a seeded plan keeps free briefs stable across regenerations.
  const referenceFile = reference ? await buildPosterDesignReference(reference) : null
  const posterPlan = referenceFile ? null : createPosterPlan(input.showId, input.title, input.date, sorted.length)

  const identityMapIndex = referenceFile ? 2 : 1
  const artistReferenceStartIndex = identityMapIndex + 1
  const referencePackage = await buildPosterReferences(sorted, artistReferenceStartIndex)
  const artistReferenceEndIndex = referencePackage.images.length > 0
    ? identityMapIndex + referencePackage.images.length - 1
    : 0
  const referenceImages = referenceFile
    ? [referenceFile, ...referencePackage.images]
    : referencePackage.images

  const prompt = buildPosterPrompt({
    sorted,
    headliners: input.headliners,
    supporting: input.supporting,
    mode: referenceFile ? 'reference' : 'free',
    title: input.title,
    dateLine: input.dateLine,
    venue: input.venue,
    posterPlan,
    identityMapIndex,
    artistReferenceStartIndex,
    artistReferenceEndIndex,
    referencePackage,
    changeRequest: input.changeRequest,
    referenceSource: input.referenceSource,
  })

  const openai = getOpenAI()
  const generateOnce = async (): Promise<Buffer> => {
    const response = referenceImages.length > 0
      ? await openai.images.edit({
        model: 'gpt-image-1.5',
        image: referenceImages,
        prompt,
        n: 1,
        size: '1024x1536',
        quality: 'high',
        input_fidelity: 'high',
        output_format: 'png',
      })
      : await openai.images.generate({
        model: 'gpt-image-1.5',
        prompt,
        n: 1,
        size: '1024x1536',
        quality: 'high',
        output_format: 'png',
      })

    const imageBase64 = response.data?.[0]?.b64_json
    if (!imageBase64) {
      throw new Error('OpenAI returnerte ikke et bilde.')
    }
    return Buffer.from(imageBase64, 'base64')
  }

  // Image generation is stochastic — a run can duplicate the title block or
  // leave empty frames no matter what the prompt says. A cheap vision audit
  // gates each candidate; the first clean one wins, else the least-broken.
  // Fail-open: if the audit itself errors, the candidate is accepted.
  const MAX_ATTEMPTS = 2
  let poster: Buffer | null = null
  let fallback: Buffer | null = null
  let fallbackProblems = Number.POSITIVE_INFINITY
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const candidate = await generateOnce()
    const problems = await auditGeneratedPoster(candidate, {
      title: input.title,
      dateLine: input.dateLine,
      venue: input.venue,
      names: sorted.map((artist) => artist.name),
      silhouetteNames: sorted.filter((artist) => !artist.profileImageUrl).map((artist) => artist.name),
    })
    if (problems.length === 0) {
      poster = candidate
      break
    }
    console.warn(`[Poster] Attempt ${attempt} rejected by audit:`, problems.join(' | '))
    if (problems.length < fallbackProblems) {
      fallback = candidate
      fallbackProblems = problems.length
    }
  }
  poster = poster ?? fallback
  if (!poster) {
    throw new Error('OpenAI returnerte ikke et bilde.')
  }

  // Image models re-letter small logo text no matter how hard the prompt
  // forbids it — paste the reference's REAL logo pixels back over the
  // generated logos. Best-effort: any failure returns the poster as-is.
  if (reference) {
    try {
      const referenceResponse = await fetch(reference.fileUrl, { cache: 'no-store' })
      if (referenceResponse.ok) {
        const referenceBuffer = Buffer.from(await referenceResponse.arrayBuffer())
        return await patchLogosFromReference(poster, referenceBuffer)
      }
    } catch (error) {
      console.warn('[Poster] Logo patch skipped (reference fetch failed):', error)
    }
  }

  return poster
}

/**
 * Cheap vision audit of a generated poster against the text manifest.
 * Returns a list of problems (empty = accept). Fail-open on any API error.
 */
async function auditGeneratedPoster(
  poster: Buffer,
  manifest: { title: string; dateLine: string; venue: string; names: string[]; silhouetteNames: string[] },
): Promise<string[]> {
  try {
    const preview = await sharp(poster)
      .resize({ width: 768, height: 1152, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer()

    const openai = getOpenAI()
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      temperature: 0,
      store: false,
      input: [
        {
          role: 'system',
          content: [{
            type: 'input_text',
            text: 'You quality-check event posters and answer with JSON only (no markdown).',
          }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                `Check this generated comedy poster against its content manifest:`,
                `- Title: "${manifest.title}"`,
                `- Date line: "${manifest.dateLine}"`,
                manifest.venue ? `- Venue: "${manifest.venue}"` : null,
                `- Comedian names: ${manifest.names.map((name) => `"${name}"`).join(', ')}`,
                ``,
                `Report problems of these kinds only:`,
                `- "duplicate": a manifest string appears in MORE than one place`,
                `- "misspelled": a manifest string is rendered with different letters (report the exact rendered text)`,
                `- "missing": a manifest string is nowhere on the poster`,
                `- "empty_frame": a portrait frame with no person AND no silhouette in it`,
                `- "gibberish": garbled/nonsense lettering anywhere`,
                `UPPERCASE/lowercase styling and dash/dot separators are NOT misspellings.`,
                manifest.silhouetteNames.length > 0
                  ? `NOTE: ${manifest.silhouetteNames.map((name) => `"${name}"`).join(', ')} intentionally appear${manifest.silhouetteNames.length === 1 ? 's' : ''} as a dark SILHOUETTE (no photo exists) — a silhouette in their frame is CORRECT, do not report it.`
                  : null,
                `Ignore: styling choices, static brand text, logos, exact positions.`,
                `Return JSON exactly like: {"problems":[{"kind":"duplicate","subject":"title"},{"kind":"misspelled","expected":"Sommershow","rendered":"Sommershov"}]} — empty array when everything is fine.`,
              ].filter(Boolean).join('\n'),
            },
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${preview.toString('base64')}`,
              detail: 'high',
            },
          ],
        },
      ],
    })

    const text = response.output_text ?? ''
    const start = text.indexOf('{')
    if (start < 0) return []
    let depth = 0
    let json: string | null = null
    for (let i = start; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1
      if (text[i] === '}') depth -= 1
      if (depth === 0) {
        json = text.slice(start, i + 1)
        break
      }
    }
    if (!json) return []
    const parsed = JSON.parse(json) as { problems?: unknown }
    if (!Array.isArray(parsed.problems)) return []

    // Vision auditors hallucinate "misspellings" that are identical or differ
    // only in casing/separators — verify their claim before trusting it.
    const normalize = (value: string) => value
      .toLocaleLowerCase('nb-NO')
      .replace(/[·•\-–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    return parsed.problems.flatMap((entry): string[] => {
      const problem = (entry ?? {}) as Record<string, unknown>
      const kind = typeof problem.kind === 'string' ? problem.kind : ''
      if (!['duplicate', 'misspelled', 'missing', 'empty_frame', 'gibberish'].includes(kind)) return []
      if (kind === 'misspelled') {
        const expected = typeof problem.expected === 'string' ? problem.expected : ''
        const rendered = typeof problem.rendered === 'string' ? problem.rendered : ''
        if (!expected || !rendered || normalize(expected) === normalize(rendered)) return []
        return [`misspelled: "${expected}" rendered as "${rendered}"`]
      }
      const subject = typeof problem.subject === 'string' ? problem.subject : ''
      return [`${kind}${subject ? `: ${subject}` : ''}`]
    }).slice(0, 8)
  } catch (error) {
    console.warn('[Poster] Audit skipped:', error)
    return []
  }
}

async function uploadGeneratedPoster(
  admin: ReturnType<typeof createAdminClient>,
  showId: string,
  imageBuffer: Buffer,
) {
  const fileName = `${showId}/poster-${Date.now()}.png`
  const { error: uploadError } = await admin.storage
    .from('generated-posters')
    .upload(fileName, imageBuffer, { contentType: 'image/png', upsert: true })

  if (uploadError) {
    throw new Error(`Kunne ikke laste opp plakat: ${uploadError.message}`)
  }

  const { data: { publicUrl } } = admin.storage
    .from('generated-posters')
    .getPublicUrl(fileName)

  const { error: updateError } = await admin.from('shows').update({ poster_url: publicUrl }).eq('id', showId)
  if (updateError) {
    throw new Error(`Kunne ikke lagre plakat på showet: ${updateError.message}`)
  }

  return publicUrl
}

function normalizeChangeRequest(input: string | null | undefined) {
  const normalized = String(input ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  return normalized.slice(0, 400)
}

function normalizePosterArtists(input: PosterArtistInput[]): PosterArtist[] {
  const seen = new Set<string>()
  return input
    .map((artist) => typeof artist === 'string'
      ? { name: artist, profileImageUrl: null, roleName: null }
      : { name: artist.name, profileImageUrl: artist.profile_image_url ?? null, roleName: artist.role_name ?? null })
    .filter((artist) => {
      const key = artist.name.toLowerCase().trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function isHeadlinerRole(roleName: string | null) {
  const normalized = roleName?.toLowerCase() ?? ''
  return normalized.includes('headliner') || normalized.includes('headline') || normalized.includes('hoved') || normalized.includes('top')
}

async function buildPosterReferences(artists: PosterArtist[], firstArtistInputIndex = 2): Promise<PosterReferencePackage> {
  const referencePhotos = await fetchPosterReferencePhotos(artists)
  if (!referencePhotos.length) return { images: [], identityLines: [] }

  const identityMap = await createIdentityMap(referencePhotos)
  const originalFiles = referencePhotos.map((photo) => photo.file)
  const identityLines = referencePhotos.map((photo, index) => (
    `${index + 1}. ${photo.artist.name}${photo.artist.roleName ? ` (${photo.artist.roleName})` : ''} - normalized Supabase profile photo supplied as input image ${firstArtistInputIndex + index}`
  ))

  return { images: [identityMap, ...originalFiles], identityLines }
}

async function buildPosterDesignReference(template: PosterDesignTemplateInput | null | undefined): Promise<Uploadable | null> {
  if (!template) return null

  try {
    const response = await fetch(template.fileUrl, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`Could not fetch design template: ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const safeName = template.fileName.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'club-design-template'
    const referenceBuffer = await normalizeOpenAIReferenceImage(buffer, 1024, 1536)
    return await toFile(referenceBuffer, `design-template-${safeName}.png`, { type: 'image/png' })
  } catch (error) {
    throw new Error(`Selected poster template "${template.fileName}" could not be prepared for image generation.`, { cause: error })
  }
}

async function fetchPosterReferencePhotos(artists: PosterArtist[]): Promise<PosterReferencePhoto[]> {
  const artistsWithImages = artists
    .filter((artist): artist is PosterArtist & { profileImageUrl: string } => Boolean(artist.profileImageUrl))
    .slice(0, 15)

  const photos: PosterReferencePhoto[] = []
  for (const [index, artist] of artistsWithImages.entries()) {
    try {
      const response = await fetch(artist.profileImageUrl, { cache: 'no-store' })
      if (!response.ok) {
        console.warn(`[Poster] Could not fetch reference image for ${artist.name}: ${response.status}`)
        continue
      }

      const contentType = response.headers.get('content-type') ?? 'image/jpeg'
      if (!contentType.startsWith('image/')) {
        console.warn(`[Poster] Reference URL for ${artist.name} is not an image: ${contentType}`)
        continue
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const referenceBuffer = await normalizeOpenAIReferenceImage(buffer, 1200, 1200)
      const safeName = artist.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || `artist-${index + 1}`
      photos.push({
        artist,
        buffer: referenceBuffer,
        file: await toFile(referenceBuffer, `${index + 1}-${safeName}.png`, { type: 'image/png' }),
      })
    } catch (error) {
      console.warn(`[Poster] Failed to prepare reference image for ${artist.name}:`, error)
    }
  }

  return photos
}

async function normalizeOpenAIReferenceImage(buffer: Buffer, maxWidth: number, maxHeight: number) {
  return sharp(buffer, { animated: false })
    .rotate()
    .resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .toColorspace('srgb')
    .png()
    .toBuffer()
}

async function createIdentityMap(photos: PosterReferencePhoto[]): Promise<Uploadable> {
  const tileWidth = 300
  const photoHeight = 300
  const labelHeight = 72
  const tileHeight = photoHeight + labelHeight
  const columns = Math.min(4, photos.length)
  const rows = Math.ceil(photos.length / columns)
  const headerHeight = 88
  const width = columns * tileWidth
  const height = headerHeight + rows * tileHeight

  const composites: sharp.OverlayOptions[] = [
    {
      input: Buffer.from(`
        <svg width="${width}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
          <rect width="100%" height="100%" fill="#111111"/>
          <text x="24" y="34" font-family="${POSTER_FONT_FAMILY}, sans-serif" font-size="24" font-weight="700" fill="#ffffff">IDENTITY MAP - DO NOT SWAP NAMES</text>
          <text x="24" y="62" font-family="${POSTER_FONT_FAMILY}, sans-serif" font-size="18" fill="#f4f4f5">Each profile photo below is labeled with the exact artist name.</text>
        </svg>
      `),
      left: 0,
      top: 0,
    },
  ]

  for (const [index, photo] of photos.entries()) {
    const column = index % columns
    const row = Math.floor(index / columns)
    const left = column * tileWidth
    const top = headerHeight + row * tileHeight
    const image = await sharp(photo.buffer)
      .resize({ width: tileWidth, height: photoHeight, fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .toColorspace('srgb')
      .png()
      .toBuffer()
    const label = Buffer.from(`
      <svg width="${tileWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#ffffff"/>
        <rect x="0" y="0" width="100%" height="1" fill="#d4d4d8"/>
        <text x="14" y="29" font-family="${POSTER_FONT_FAMILY}, sans-serif" font-size="21" font-weight="800" fill="#111111">${index + 1}. ${escapeSvgText(photo.artist.name)}</text>
        ${photo.artist.roleName ? `<text x="14" y="54" font-family="${POSTER_FONT_FAMILY}, sans-serif" font-size="15" fill="#52525b">${escapeSvgText(photo.artist.roleName)}</text>` : ''}
      </svg>
    `)

    composites.push({ input: image, left, top })
    composites.push({ input: label, left, top: top + photoHeight })
  }

  const sheet = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#f4f4f5',
    },
  })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toBuffer()

  return toFile(sheet, '00-identity-map-names-and-faces.jpg', { type: 'image/jpeg' })
}

function createPosterPlan(showId: string, title: string, date: string, artistCount: number) {
  const plans = [
    {
      concept: 'premium black-box theatre premiere, cinematic and elegant',
      composition: artistCount > 3 ? 'clean ensemble row with the headliner slightly larger, title anchored at the bottom' : artistCount > 1 ? 'large central portrait with supporting artists in smaller side columns' : 'large central portrait filling the frame, no secondary portraits',
      photoTreatment: 'authentic photo cutouts with subtle rim light, natural skin, no illustration filter',
      palette: 'black, warm ivory, restrained gold accents',
      typography: 'tall condensed sans-serif names at top, expressive serif title at bottom',
      texture: 'fine stage haze, soft spotlight gradients, thin gold divider lines',
    },
    {
      concept: 'bright Norwegian comedy gala poster with magazine-cover energy',
      composition: artistCount > 4 ? 'stacked group collage with one overlapping portrait cutout per artist' : artistCount > 1 ? 'three-quarter portrait collage with dynamic diagonals, one portrait per artist' : 'single three-quarter hero portrait with dynamic diagonals, no cameos or duplicates',
      photoTreatment: 'clean press-photo cutouts, exact faces, light studio shadow behind each comedian',
      palette: 'off-white, black, burgundy, metallic champagne',
      typography: 'bold editorial sans-serif headline with compact credit blocks',
      texture: 'paper grain, subtle halftone shadows, ticket-stub footer',
    },
    {
      concept: 'retro 1970s comedy special with colorful graphic shapes',
      composition: artistCount > 1 ? 'large circular or arched portrait windows around the title, exactly one window per artist' : 'one large circular or arched hero portrait window around the title, no secondary portraits',
      photoTreatment: 'profile photos placed as crisp photo inserts, not redrawn; warm studio color grade only',
      palette: 'coral, teal, ochre, cream, deep brown text',
      typography: 'chunky rounded display title with small clean venue/date text',
      texture: 'screenprint grain and layered poster shapes',
    },
    {
      concept: 'minimal typographic club poster, sharp and modern',
      composition: artistCount > 1 ? 'oversized title typography with exact artist portraits in a neat grid or strip, one portrait per artist' : 'oversized title typography with one exact artist portrait, no repeated portrait strip',
      photoTreatment: 'small but crisp unchanged portrait crops with clear eyes and faces',
      palette: 'white, black, signal red, one accent color',
      typography: 'Swiss grid sans-serif, strong hierarchy, lots of breathing room',
      texture: 'clean print layout with tiny registration marks and rules',
    },
    {
      concept: 'playful smiley-pattern comedy poster with strong ticket-sales energy',
      composition: artistCount > 1 ? 'one hero comedian photo against a repeated graphic motif, other comedians as smaller badges' : 'one large hero comedian photo against a repeated graphic motif, no secondary portraits or badges',
      photoTreatment: 'source-photo cutouts preserved exactly, crisp edges, no cartooning',
      palette: 'yellow, black, white, small red accents',
      typography: 'heavy block title, compact date pill, bold footer callout',
      texture: 'sticker edges, light photocopy grain, venue-poster roughness',
    },
    {
      concept: 'Nordic outdoor summer comedy poster, fresh and unexpected',
      composition: artistCount > 1 ? 'artist photos arranged as natural editorial portraits over a scenic but graphic backdrop, one portrait per artist' : 'one natural editorial hero portrait over a scenic but graphic backdrop, no extra faces',
      photoTreatment: 'realistic source-photo integration, natural daylight grade, exact faces',
      palette: 'forest green, sky blue, white, warm yellow',
      typography: 'large friendly sans-serif title with clean festival-style info blocks',
      texture: 'soft film grain, organic shapes, subtle sun flare',
    },
    {
      concept: 'tabloid-premiere poster with big confidence and humor',
      composition: artistCount > 1 ? 'tight crop portrait collage with one crop per artist, oversized title across the middle like a headline' : 'single tight crop hero portrait with oversized title across the middle like a headline, no duplicate crops',
      photoTreatment: 'unchanged profile faces, high-contrast editorial press lighting',
      palette: 'black, white, red, saturated gold',
      typography: 'bold newspaper headline mixed with compact sans-serif credits',
      texture: 'newsprint grain, torn-paper accents, sticker-like date mark',
    },
    {
      concept: 'clean pink/cream solo-special style with retro broadcast graphics',
      composition: 'single strong hero portrait if one headliner, otherwise stacked cameo portraits around the title',
      photoTreatment: 'profile photos as exact photographic inserts with very light color matching only',
      palette: 'soft pink, cream, orange, burgundy, muted blue',
      typography: 'friendly chunky display title with tidy uppercase metadata',
      texture: 'soft paper grain, simple abstract rings, vintage TV warmth',
    },
  ]

  const index = stableHash(`${showId}:${title}:${date}`) % plans.length
  return plans[index]
}

function stableHash(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function formatPosterDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'short' }).format(date)
}

