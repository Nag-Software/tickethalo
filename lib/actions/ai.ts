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
    const venue = opts.venue || 'Tickethalo'
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

    const headlinerNames = headliners.map(a => a.name).join(' og ')
    const supportNames   = supporting.map(a => a.name).join(', ')
    const allNames       = sorted.map(a => a.name).join(', ')
    const referenceArtistCount = referencePackage.identityLines.length
    const portraitCountRule = referenceArtistCount > 0
      ? `The final poster must contain exactly ${referenceArtistCount} supplied comedian portrait${referenceArtistCount === 1 ? '' : 's'}: one portrait per supplied profile photo, no repeated faces, no duplicate cutouts, no mirrored copies, no extra headshots, and no generated additional comedians.`
      : `No supplied artist photos are available. Do not create prominent fake comedian faces; use typography, venue atmosphere, graphic motifs, and event details to carry the design.`
    const referenceList = referencePackage.identityLines.length > 0
      ? referencePackage.identityLines.join('\n')
      : sorted.map((artist) => `${artist.name}${artist.roleName ? ` (${artist.roleName})` : ''} - no reference photo`).join('\n')

    const prompt = [
      designReference
        ? `Edit the selected poster template in input image 1. Do not create a new poster.`
        : `Create a ticket-selling Norwegian standup comedy show poster in portrait format (2:3 ratio).`,
      ``,
      `PRIMARY GOAL:`,
      designReference
        ? `- Preserve the uploaded template as the base artwork. The AI is acting as an editing tool, not a poster designer.`
        : `- Make a real audience want to buy tickets: high-impact, premium, funny, confident, and instantly readable in a social feed or ticketing page thumbnail.`,
      designReference
        ? `- Only make these edits: insert the current artist photos into existing photo areas, and replace outdated event text with current show details.`
        : `- The poster must still feel like a credible Norwegian comedy venue poster, not generic AI art, stock advertising, or a movie poster parody.`,
      designReference
        ? `- Priority order: 1) preserve template logos/branding/layout, 2) exact artist identity, 3) replace text cleanly.`
        : `- Priority order: 1) exact artist identity, 2) readable title/date/venue, 3) attention-grabbing composition, 4) tasteful texture and details.`,
      ``,
      `SHOW DETAILS:`,
      `- Title: "${opts.title}"`,
      `- Headliner comedian(s): ${headlinerNames || allNames}`,
      supporting.length > 0 ? `- Supporting comedians: ${supportNames}` : null,
      `- Date: ${dateText}${timeText ? `, ${timeText}` : ''}`,
      `- Venue: ${venue}`,
      ``,
      `REFERENCE PHOTOS AND FACE RULES:`,
      referenceList,
      portraitCountRule,
      referencePackage.images.length > 0
        ? `Input image ${identityMapIndex} is a labeled IDENTITY MAP. The name printed directly under each face is the canonical mapping. Match every face to that exact printed name. Input images ${artistReferenceStartIndex} through ${artistReferenceEndIndex} are normalized PNG versions of the Supabase profile photos in the exact same numbered order as the identity list above. Use only those artist profile photos as the source of truth for the comedians. Preserve identity, face geometry, skin tone, expression, hair, glasses, beard, and distinctive features with high fidelity. Do not invent replacement faces, do not beautify, do not age-change, do not caricature, do not merge faces, and do not change body type or age. Use the supplied photos as authentic press/profile imagery in the poster composition.`
        : `For the named artists, rely on names and typography instead of fabricated portraits.`,
      designReference ? `` : null,
      designReference ? `SELECTED CLUB DESIGN TEMPLATE:` : null,
      designReference ? designReference.promptLine.replace('{index}', String(designReferenceIndex)) : null,
      designReference ? `STRICT EDIT MODE: Treat input image 1 as the base canvas. Preserve all existing non-text artwork: logos, venue logos, sponsor logos, icons, footer marks, backgrounds, textures, color palette, borders, splashes, decorative elements, layout grid, spacing, and typography style. Do not redraw, restyle, replace, move, or reinterpret logos or branding. Do not invent new graphic elements.` : null,
      designReference ? `ALLOWED EDITS ONLY: 1) Put the supplied artist photos into existing blank/photo areas. 2) Replace old names, date/time, venue, title, and event copy with the current show details above. Keep text in the same approximate positions, sizes, alignment, color, and hierarchy as the template. If a piece of existing text is a logo/brand mark, preserve it unchanged.` : null,
      designReference ? `PHOTO SLOT RULES: If the template contains rectangular blank photo boxes, place photos inside those same rectangles. Do not convert rectangles into circles, bubbles, badges, arches, stickers, or a collage. Do not add extra portrait frames. If there are more template slots than artists, leave extra slots visually consistent with the template instead of inventing people.` : null,
      designReference ? `The final image should look like input image 1 was manually edited for this show, with only photos and editable event text changed.` : null,
      designReference ? null : ``,
      designReference ? null : `POSTER PLAN FOR THIS SPECIFIC SHOW:`,
      posterPlan ? `- Concept: ${posterPlan.concept}` : null,
      posterPlan ? `- Composition: ${posterPlan.composition}` : null,
      posterPlan ? `- Photo treatment: ${posterPlan.photoTreatment}` : null,
      posterPlan ? `- Palette: ${posterPlan.palette}` : null,
      posterPlan ? `- Typography: ${posterPlan.typography}` : null,
      posterPlan ? `- Texture/detail: ${posterPlan.texture}` : null,
      ``,
      `DESIGN REQUIREMENTS:`,
      designReference ? `- Do not invent a new layout. Preserve the selected template's exact grid and visual system as the dominant requirement.` : `- Make this poster visually distinct from other Tickethalo posters; follow the show-specific plan above.`,
      designReference ? `- Do not change logos, brand marks, footer logos, sponsor marks, background photography, textures, decorative marks, or color system from the template.` : `- Norwegian comedy poster quality: credible enough for Latter, Stand Up Norge, venue posters, and ticketing pages.`,
      designReference ? `- Replace only editable event text. Keep existing logo text and brand text unchanged.` : `- Title "${opts.title}" must be the dominant readable text, with a strong silhouette and high contrast.`,
      designReference ? `- Keep date, time, venue, title, and artist names legible within the template's existing text areas.` : `- Include date, time, and venue clearly. They must remain legible at phone-screen size.`,
      designReference ? null : `- Include a small footer exactly as: "BILLETTER · TICKETHALO".`,
      `- Keep faces crisp, undistorted, and recognizable. Authenticity is more important than stylization, humor, or visual novelty.`,
      `- The visible artist name next to or above each portrait must match the face according to the labeled IDENTITY MAP. Never swap names between faces.`,
      `- Do not copy the IDENTITY MAP layout, numbers, grid, or reference labels into the final poster; use it only to map each name to the correct face.`,
      designReference ? `- Avoid unrelated decoration, new palettes, new mask shapes, new footer text, new logos, fake sponsors, fake QR codes, or a new composition that does not exist in the template.` : `- Use clean negative space, strong hierarchy, and punchy color contrast. Avoid clutter, tiny unreadable text, fake QR codes, fake sponsors, fake prices, and extra decorative labels.`,
      `- Do not add unrelated people, audience faces, celebrity lookalikes, random host portraits, or background faces that could be mistaken for lineup members.`,
      `- No fake names, no extra comedians, no malformed faces, no duplicated people.`,
      sorted.length === 1 ? `- There is exactly 1 comedian in this lineup. Include exactly ONE portrait of this person. Do not add badges, secondary thumbnails, or any duplicate representation of the same comedian.` : null,
    ].filter(Boolean).join('\n')

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
      promptLine: `Input image {index} is the selected club design template "${label}" (normalized uploaded image file). Treat it as the base image to edit, not as loose inspiration. Preserve its non-text artwork and branding.`,
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

