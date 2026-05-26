'use server'

import { toFile, type Uploadable } from 'openai'
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenAI } from '@/lib/openai'

type PosterArtistInput = string | {
  name: string
  profile_image_url?: string | null
  role_name?: string | null
}

type PosterArtist = {
  name: string
  profileImageUrl: string | null
  roleName: string | null
}

type PosterDesignTemplate = {
  label: string | null
  fileUrl: string
  filePath: string
  fileName: string
  mimeType: string
}

type PosterReferencePhoto = {
  artist: PosterArtist & { profileImageUrl: string }
  buffer: Buffer
  file: Uploadable
}

type PosterReferencePackage = {
  images: Uploadable[]
  identityLines: string[]
}

type PosterDesignReference = {
  file: Uploadable
  promptLine: string
}

type PosterPromptContext = {
  title: string
  dateText: string
  timeText: string
  venue: string
  sorted: PosterArtist[]
  headliners: PosterArtist[]
  supporting: PosterArtist[]
  designReference: PosterDesignReference | null
  designReferenceIndex: number | null
  posterPlan: ReturnType<typeof createPosterPlan> | null
  identityMapIndex: number
  artistReferenceStartIndex: number
  artistReferenceEndIndex: number
  referencePackage: PosterReferencePackage
}

function buildPosterGenerationPrompt(ctx: PosterPromptContext): string {
  const {
    title,
    dateText,
    timeText,
    venue,
    sorted,
    headliners,
    supporting,
    designReference,
    designReferenceIndex,
    posterPlan,
    identityMapIndex,
    artistReferenceStartIndex,
    artistReferenceEndIndex,
    referencePackage,
  } = ctx

  const artistCount = sorted.length
  const headlinerNames = headliners.map(a => a.name).join(' og ')
  const supportNames = supporting.map(a => a.name).join(', ')
  const allNames = sorted.map(a => a.name).join(', ')
  const referenceArtistCount = referencePackage.identityLines.length
  const dateLine = timeText ? `${dateText} · ${timeText}` : dateText
  const templateLabel = designReference?.promptLine.replace('{index}', String(designReferenceIndex)) ?? ''

  const portraitCountRule = referenceArtistCount > 0
    ? `Final poster: exactly ${referenceArtistCount} supplied portrait${referenceArtistCount === 1 ? '' : 's'} — one per profile photo. No duplicates, mirrors, extra headshots, or invented comedians.`
    : `No profile photos supplied. Do not invent prominent comedian faces; let typography and event details carry the poster.`

  const referenceList = referencePackage.identityLines.length > 0
    ? referencePackage.identityLines.join('\n')
    : sorted.map((artist) => `${artist.name}${artist.roleName ? ` (${artist.roleName})` : ''} — no reference photo`).join('\n')

  const faceMappingBlock = referencePackage.images.length > 0
    ? [
      `Input image ${identityMapIndex} = IDENTITY MAP (mapping only — never reproduce this grid in the final poster).`,
      `Input images ${artistReferenceStartIndex}–${artistReferenceEndIndex} = profile photos in the same numbered order as the identity list.`,
      `Preserve each face exactly: geometry, skin tone, expression, hair, glasses, beard, age. No beautifying, caricature, merging, or swapping.`,
    ].join('\n')
    : `No reference photos: use names in typography only; do not fabricate portraits.`

  const conciseCopyBlock = [
    `CONCISE NORWEGIAN COPY (mandatory):`,
    `- Write like a top-tier venue poster: scannable in 3 seconds at phone width (~400px).`,
    `- Show title: use exactly "${title}" — prefer one strong line.`,
    `- Comedian names: stage names only (${allNames}). No bios, no quotes, no hashtags.`,
    headliners.length > 0 && supporting.length > 0
      ? `- Hierarchy: headliner(s) "${headlinerNames}" most prominent; supporting "${supportNames}" secondary.`
      : null,
    `- Date/time: "${dateLine}" — compact, no filler words.`,
    `- Venue: "${venue}" — shorten to city or short venue name if the template is tight.`,
    `- Hard limit: max 6 text elements on the entire poster (title, names, date, venue, footer brand).`,
    `- Forbidden: paragraphs, ticket prices, URLs, QR codes, sponsor invented text, "kveld med", "presenterer", marketing slogans.`,
  ]

  const lineupAdaptationBlock = designReference
    ? [
      `ADAPT TEMPLATE TO THIS LINEUP (${artistCount} comedian${artistCount === 1 ? '' : 's'}):`,
      `- First study input image 1: note photo frames, name areas, title block, date/venue zones, and visual hierarchy.`,
      `- This show lineup (${artistCount}): ${allNames}.`,
      artistCount === 1
        ? `- Solo show: one portrait only. Remove or neutralize extra template photo slots without breaking the layout. No duplicate thumbnails or badges.`
        : null,
      artistCount > 1
        ? `- Ensemble: ${artistCount} distinct comedians — one portrait per person, matched to the correct name.`
        : null,
      `- More template slots than comedians: hide or tone down empty slots using the template's own background/texture; never invent people.`,
      `- Fewer template slots than comedians: headliner(s) in the largest slot(s); list remaining names in existing text areas only — do not add portrait frames.`,
      `- Rebalance spacing only if needed so ${artistCount} face(s) read clearly; keep the template's shapes, masks, and color system.`,
    ]
    : null

  const templateModeBlock = designReference
    ? [
      `TASK: TEMPLATE EDIT — not a new design.`,
      `You are a senior poster retoucher. Input image 1 is the club's master template and design system.`,
      templateLabel,
      ``,
      `TEMPLATE AS DESIGN CONTEXT:`,
      `- Treat the template as law for: color palette, typography style, grid, margins, textures, backgrounds, logos, sponsor marks, decorative graphics.`,
      `- Your job: adapt this exact visual system to the current show — same club, new lineup and event facts.`,
      `- The result must look like a designer manually updated the template in Photoshop/Figma, not like a new AI poster.`,
      ``,
      `ALLOWED CHANGES ONLY:`,
      `1. Insert supplied profile photos into existing photo areas (same shape, frame, crop style as template).`,
      `2. Replace outdated event text (title, comedian names, date, time, venue) with SHOW DETAILS below.`,
      `3. Adjust lineup layout only to fit the actual comedian count (see ADAPT TEMPLATE below).`,
      ``,
      `FORBIDDEN CHANGES:`,
      `- New layout, new palette, new fonts, new logos, new decorative elements, new photo frame shapes.`,
      `- Redrawing, moving, or restyling existing logos, brand marks, venue marks, or sponsor graphics.`,
      `- Circles/bubbles/collage if the template uses rectangles; no extra portrait frames.`,
      ...(lineupAdaptationBlock ?? []),
      ``,
      `PRIORITY: 1) preserve template branding/layout  2) correct face-to-name mapping  3) concise updated copy.`,
    ]
    : [
      `TASK: CREATE a new Norwegian standup comedy poster (portrait 2:3).`,
      `You are a senior event poster designer (venue / festival / ticketing quality).`,
      ``,
      `DESIGN EXCELLENCE (state-of-the-art):`,
      `- Mobile-first: must sell tickets in Instagram feed and ticketing thumbnails.`,
      `- One clear focal point; max 3 hierarchy levels (headline → lineup/date → footer).`,
      `- Generous whitespace; punchy contrast; no clutter or generic AI gloss.`,
      `- Credible Norwegian comedy poster (Latter, Stand Up Norge, club standards) — not movie poster, not stock ad.`,
      ``,
      `SHOW-SPECIFIC PLAN:`,
      posterPlan ? `- Concept: ${posterPlan.concept}` : null,
      posterPlan ? `- Composition: ${posterPlan.composition}` : null,
      posterPlan ? `- Photo treatment: ${posterPlan.photoTreatment}` : null,
      posterPlan ? `- Palette: ${posterPlan.palette}` : null,
      posterPlan ? `- Typography: ${posterPlan.typography}` : null,
      posterPlan ? `- Texture: ${posterPlan.texture}` : null,
      `- Footer exactly: "BILLETTER · HUMOR.EVENTS".`,
      `- Title "${title}" = dominant readable element.`,
      ``,
      `PRIORITY: 1) exact artist identity  2) concise readable facts  3) strong composition  4) subtle texture.`,
    ]

  return [
    ...templateModeBlock,
    ``,
    `SHOW DETAILS (source of truth for all text):`,
    `- Title: "${title}"`,
    `- Lineup (${artistCount}): ${allNames}`,
    headliners.length > 0 ? `- Headliner(s): ${headlinerNames || allNames}` : null,
    supporting.length > 0 ? `- Supporting: ${supportNames}` : null,
    `- Date/time: ${dateLine}`,
    `- Venue: ${venue}`,
    ``,
    ...conciseCopyBlock,
    ``,
    `ARTIST PHOTOS & IDENTITY:`,
    referenceList,
    portraitCountRule,
    faceMappingBlock,
    ``,
    `QUALITY BAR:`,
    designReference
      ? `- Final image = input image 1 with photos and event text updated for this show only.`
      : `- Distinct, premium, instantly readable; faces authentic over stylized.`,
    `- Name beside each portrait must match IDENTITY MAP. Never swap names.`,
    `- No audience faces, lookalikes, or background people mistaken for lineup.`,
    `- No fake names, malformed faces, or duplicate representations.`,
  ].filter(Boolean).join('\n')
}

export async function generateShowPoster(showId: string, opts: {
  title: string
  date: string
  startTime?: string | null
  venue: string
  artists: PosterArtistInput[]
  designTemplate?: PosterDesignTemplate | null
  throwOnError?: boolean
}): Promise<string | null> {
  const admin = createAdminClient()

  try {
    const artists = normalizePosterArtists(opts.artists)
    const headliners = artists.filter(a => isHeadlinerRole(a.roleName))
    const supporting = artists.filter(a => !isHeadlinerRole(a.roleName))
    const sorted = [...headliners, ...supporting]

    const dateText = formatPosterDate(opts.date)
    const timeText = opts.startTime ? `kl. ${opts.startTime.slice(0, 5)}` : ''
    const venue = opts.venue || 'humor.events'
    const designReference = await buildPosterDesignReference(opts.designTemplate)
    const posterPlan = designReference ? null : createPosterPlan(showId, opts.title, opts.date, sorted.length)
    const identityMapIndex = designReference ? 2 : 1
    const artistReferenceStartIndex = identityMapIndex + 1
    const referencePackage = await buildPosterReferences(sorted, artistReferenceStartIndex)
    const designReferenceIndex = designReference ? 1 : null
    const artistReferenceEndIndex = referencePackage.images.length > 0
      ? identityMapIndex + referencePackage.images.length - 1
      : 0
    const referenceImages = designReference
      ? [designReference.file, ...referencePackage.images]
      : referencePackage.images

    const prompt = buildPosterGenerationPrompt({
      title: opts.title,
      dateText,
      timeText,
      venue,
      sorted,
      headliners,
      supporting,
      designReference,
      designReferenceIndex,
      posterPlan,
      identityMapIndex,
      artistReferenceStartIndex,
      artistReferenceEndIndex,
      referencePackage,
    })

    const openai = getOpenAI()
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

    const imageBuffer = Buffer.from(imageBase64, 'base64')
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
  } catch (err) {
    console.error('[Poster] Generation failed:', err)
    if (opts.throwOnError) {
      if (err instanceof Error) throw err
      throw new Error('Kunne ikke generere plakat akkurat nå.')
    }
    return null
  }
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

async function buildPosterDesignReference(template: PosterDesignTemplate | null | undefined): Promise<PosterDesignReference | null> {
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
    const file = await toFile(referenceBuffer, `design-template-${safeName}.png`, { type: 'image/png' })
    const label = template.label?.trim() || template.fileName

    return {
      file,
      promptLine: `Input image {index} = club poster template "${label}". This is the full design context: layout, typography, colors, photo frames, logos, and branding. Edit this file — do not use it as loose inspiration.`,
    }
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
          <text x="24" y="34" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#ffffff">IDENTITY MAP - DO NOT SWAP NAMES</text>
          <text x="24" y="62" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="#f4f4f5">Each profile photo below is labeled with the exact artist name.</text>
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
        <text x="14" y="29" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="800" fill="#111111">${index + 1}. ${escapeSvgText(photo.artist.name)}</text>
        ${photo.artist.roleName ? `<text x="14" y="54" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#52525b">${escapeSvgText(photo.artist.roleName)}</text>` : ''}
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

function escapeSvgText(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
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

