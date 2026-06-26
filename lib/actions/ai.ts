'use server'

import { toFile, type Uploadable } from 'openai'
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenAI } from '@/lib/openai'
import { POSTER_FONT_FAMILY, ensurePosterFonts } from '@/lib/poster-fonts'
import {
  buildPosterFaceTile,
  escapeSvgText,
  fetchPosterFaceAssets,
  type PosterArtist,
} from '@/lib/poster-compose'
import { renderPosterFromTemplate } from '@/lib/poster-render'
import { templateRowToSchema } from '@/lib/poster-template'
import type { PosterDesignTemplate, PosterMode } from '@/lib/poster-assets'
import type { PosterTemplate } from '@/types/database'

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
  changeRequest: string | null
  referenceSource: 'show' | 'club' | null
}

type PosterFramePlan = {
  x: number
  y: number
  width: number
  height: number
  labelRatio: number
  fontScale: number
}

type PosterProtectedZone = {
  x: number
  y: number
  width: number
  height: number
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
    changeRequest,
    referenceSource,
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

  const changeRequestBlock = changeRequest
    ? [
      `BRUKERØNSKE FOR NY VERSJON (høy prioritet):`,
      `- ${changeRequest}`,
      `- Gjør synlige justeringer i denne retningen, men behold korrekt lineup-identitet og eventfakta.`,
    ]
    : null

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
      `TASK: IDENTITETSBEVARENDE REDIGERING — not a new design.`,
      referenceSource === 'club'
        ? `Input image 1 is the club's standard reference poster. Preserve this visual identity across all shows.`
        : `Input image 1 is this show's reference poster. Preserve this exact visual identity.`,
      templateLabel,
      ``,
      `TEMPLATE AS DESIGN CONTEXT:`,
      `- Treat the reference as law for: color palette, typography style, grid, margins, textures, backgrounds, logos, sponsor marks, decorative graphics.`,
      `- Your job: adapt this exact visual system to the current show — same club identity, new lineup and event facts.`,
      `- The result must look like a designer manually updated the reference in Photoshop/Figma, not like a new AI poster.`,
      ``,
      `ALLOWED CHANGES ONLY:`,
      `0. Keep input image 1 as an immutable base layer (Layer 1).`,
      `1. Replace comedian profile photos inside existing photo areas only (same shape, frame, crop style as reference).`,
      `2. Replace event text (title, comedian names, date, time, venue) with SHOW DETAILS below.`,
      `3. Adjust person-slot layout only when comedian count changes (see ADAPT TEMPLATE below).`,
      `4. Composite all new/updated elements as Layer 2 above the reference, then flatten for final export.`,
      ``,
      `FORBIDDEN CHANGES:`,
      `- Do not alter, redraw, remove, regenerate, or restyle reference pixels on Layer 1.`,
      `- Do NOT add new frames, overlays, collages, bubbles, or portrait tiles on top of the reference.`,
      `- Do NOT place photos or text outside existing template slots unless adapting lineup count.`,
      `- New layout, new palette, new fonts, new logos, new decorative elements, new photo frame shapes.`,
      `- Redrawing, moving, or restyling existing logos, brand marks, venue marks, or sponsor graphics.`,
      ...(lineupAdaptationBlock ?? []),
      ``,
      `PRIORITY: 1) preserve reference branding/layout  2) correct face-to-name mapping  3) concise updated copy.`,
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
    ...(changeRequestBlock ?? []),
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
      ? `- Final image = input image 1 preserved as Layer 1, with show-specific updates composited as Layer 2, then flattened.`
      : `- Distinct, premium, instantly readable; faces authentic over stylized.`,
    `- Name beside each portrait must match IDENTITY MAP. Never swap names.`,
    `- No audience faces, lookalikes, or background people mistaken for lineup.`,
    `- No fake names, malformed faces, or duplicate representations.`,
  ].filter(Boolean).join('\n')
}

export async function generateShowPoster(showId: string, opts: {
  mode: PosterMode
  title: string
  date: string
  startTime?: string | null
  venue: string
  artists: PosterArtistInput[]
  aiReference?: PosterDesignTemplate | null
  frameBackground?: PosterDesignTemplate | null
  posterTemplate?: PosterTemplate | null
  aiReferenceSource?: 'show' | 'club' | null
  changeRequest?: string | null
  throwOnError?: boolean
}): Promise<string | null> {
  const admin = createAdminClient()

  try {
    ensurePosterFonts()
    const artists = normalizePosterArtists(opts.artists)
    const headliners = artists.filter(a => isHeadlinerRole(a.roleName))
    const supporting = artists.filter(a => !isHeadlinerRole(a.roleName))
    const sorted = [...headliners, ...supporting]
    const changeRequest = normalizeChangeRequest(opts.changeRequest)

    if (opts.mode === 'template') {
      if (!opts.posterTemplate) {
        throw new Error('Mal-modus krever en valgt plakatmal. Lag en mal under klubbinnstillinger, eller velg en for showet.')
      }

      const rendered = await renderPosterFromTemplate({
        schema: templateRowToSchema(opts.posterTemplate),
        title: opts.title,
        dateText: formatPosterDate(opts.date),
        timeText: opts.startTime ? `kl. ${opts.startTime.slice(0, 5)}` : '',
        venue: opts.venue || 'humor.events',
        headliners,
        supporting,
      })

      return await uploadGeneratedPoster(admin, showId, rendered)
    }

    if (opts.mode === 'framed') {
      if (!opts.frameBackground) {
        throw new Error('Ramme-modus krever en bakgrunn uten personer eller tekst. Last opp bakgrunn eller sett klubb-standard.')
      }

      const renderedPoster = await renderTemplatePosterWithAutoLayout({
        artists: sorted,
        template: opts.frameBackground,
      })

      return await uploadGeneratedPoster(admin, showId, renderedPoster)
    }

    const dateText = formatPosterDate(opts.date)
    const timeText = opts.startTime ? `kl. ${opts.startTime.slice(0, 5)}` : ''
    const venue = opts.venue || 'humor.events'
    let designReference: PosterDesignReference | null = null

    if (opts.aiReference) {
      designReference = await buildPosterDesignReference(opts.aiReference)
    }

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
      changeRequest,
      referenceSource: opts.aiReferenceSource ?? (opts.aiReference?.source === 'club_default' ? 'club' : opts.aiReference ? 'show' : null),
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
    return await uploadGeneratedPoster(admin, showId, imageBuffer)
  } catch (err) {
    console.error('[Poster] Generation failed:', err)
    if (opts.throwOnError) {
      if (err instanceof Error) throw err
      throw new Error('Kunne ikke generere plakat akkurat nå.')
    }
    return null
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

async function renderTemplatePosterWithAutoLayout(input: {
  artists: PosterArtist[]
  template: PosterDesignTemplateInput
}): Promise<Buffer> {
  const { artists, template } = input
  if (artists.length === 0) {
    throw new Error('Kan ikke generere plakat uten artister i lineup.')
  }

  ensurePosterFonts()

  const templateResponse = await fetch(template.fileUrl, { cache: 'no-store' })
  if (!templateResponse.ok) {
    throw new Error(`Kunne ikke laste template: ${templateResponse.status}`)
  }

  const templateBuffer = await sharp(Buffer.from(await templateResponse.arrayBuffer()), { animated: false })
    .rotate()
    .toColorspace('srgb')
    .png()
    .toBuffer()

  const metadata = await sharp(templateBuffer).metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error('Template-bildet mangler gyldig størrelse.')
  }

  const protectedZones = await detectTemplateProtectedZones(templateBuffer)

  const framePlan = await buildAutoLayoutFramesFromAI({
    templateBuffer,
    artistCount: artists.length,
    protectedZones,
  })

  const assets = await fetchPosterFaceAssets(artists)
  const composites: sharp.OverlayOptions[] = []

  for (let index = 0; index < artists.length; index += 1) {
    const artist = artists[index]
    const frame = framePlan[index]
    if (!frame) break

    const left = Math.round(frame.x * metadata.width)
    const top = Math.round(frame.y * metadata.height)
    const width = Math.max(110, Math.round(frame.width * metadata.width))
    const height = Math.max(170, Math.round(frame.height * metadata.height))
    const labelHeight = Math.min(height - 30, Math.max(34, Math.round(height * frame.labelRatio)))
    const fontSize = Math.max(14, Math.round(height * frame.fontScale))

    const tile = await buildPosterFaceTile({
      name: artist.name,
      photoBuffer: assets[index]?.buffer ?? null,
      width,
      height,
      labelHeight,
      fontSize,
    })

    composites.push({
      input: tile,
      left,
      top,
    })
  }

  return sharp(templateBuffer)
    .composite(composites)
    .png()
    .toBuffer()
}

async function buildAutoLayoutFramesFromAI(input: {
  templateBuffer: Buffer
  artistCount: number
  protectedZones: PosterProtectedZone[]
}): Promise<PosterFramePlan[]> {
  const { templateBuffer, artistCount, protectedZones } = input
  const safeBottom = getPosterSafeBottomLimit(artistCount)
  const fallback = buildSymmetricFallbackFrames(artistCount, protectedZones, safeBottom)
  const protectedZonesText = formatProtectedZonesForPrompt(protectedZones)
  const rowRule = artistCount >= 5
    ? '- Use 2-3 balanced rows; never place all portraits in a single long row.'
    : '- Keep a simple centered row layout.'

  try {
    const previewBuffer = await sharp(templateBuffer)
      .resize({ width: 768, height: 1152, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer()

    const openai = getOpenAI()
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      temperature: 0.1,
      store: false,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'You place portrait frames on event poster templates. Return JSON only. Keep frames symmetric, natural, and inside safe areas with balanced spacing. Never output markdown.',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                `Place ${artistCount} portrait frames with label area under each portrait.`,
                'Output schema:',
                '{"frames":[{"x":0.1,"y":0.2,"width":0.2,"height":0.3,"labelRatio":0.2,"fontScale":0.1}]}',
                'Rules:',
                '- All values are normalized (0-1) relative to full poster.',
                '- Return exactly one frame per artist.',
                '- Keep at least 2% gap between frames.',
                '- Keep all frames fully inside poster.',
                '- Frame height must include portrait + name label below. Treat the full tile as collision area.',
                `- Entire tile (frame + name) must stay above y=${safeBottom.toFixed(3)}.`,
                '- Keep layout centered, simple, and symmetrical (clean grid look).',
                rowRule,
                '- Avoid top logos/title zones and bottom footer zones if visible.',
                `- Forbidden zones (never place frames there): ${protectedZonesText}`,
                '- Frames should look symmetric and production-ready.',
              ].join('\n'),
            },
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${previewBuffer.toString('base64')}`,
              detail: 'high',
            },
          ],
        },
      ],
    })

    const jsonBlock = extractJsonObject(response.output_text ?? '')
    if (!jsonBlock) return fallback

    const parsed = JSON.parse(jsonBlock) as { frames?: PosterFramePlan[] }
    if (!parsed || !Array.isArray(parsed.frames)) return fallback

    const normalized = normalizeFramePlan(parsed.frames, artistCount, protectedZones, safeBottom)
    if (!normalized) return fallback
    if (!isPlanSimpleSymmetric(normalized, artistCount)) return fallback
    if (averageFrameArea(normalized) < averageFrameArea(fallback) * 0.9) return fallback

    return normalized
  } catch (error) {
    console.warn('[Poster] AI frame layout failed, using protected fallback grid:', error)
    return fallback
  }
}

function normalizeFramePlan(frames: PosterFramePlan[], expectedCount: number, protectedZones: PosterProtectedZone[], safeBottom: number): PosterFramePlan[] | null {
  if (frames.length !== expectedCount) return null

  const normalized = frames.map((frame) => ({
    x: clampNumber(frame.x, 0, 0.95),
    y: clampNumber(frame.y, 0, 0.95),
    width: clampNumber(frame.width, 0.12, 0.55),
    height: clampNumber(frame.height, 0.18, 0.6),
    labelRatio: clampNumber(frame.labelRatio, 0.16, 0.34),
    fontScale: clampNumber(frame.fontScale, 0.08, 0.2),
  }))

  for (const frame of normalized) {
    if (frame.x + frame.width > 0.985) return null
    if (frame.y + frame.height > 0.985) return null
    if (frame.y + frame.height > safeBottom) return null
    if (frameOverlapsProtectedZones(frame, protectedZones, 0, 0.012)) return null
  }

  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      if (hasHeavyOverlap(normalized[i], normalized[j])) {
        return null
      }
    }
  }

  return normalized
}

function hasHeavyOverlap(a: PosterFramePlan, b: PosterFramePlan) {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= left || bottom <= top) return false

  const overlapArea = (right - left) * (bottom - top)
  const smallerArea = Math.min(a.width * a.height, b.width * b.height)
  return overlapArea / smallerArea > 0.12
}

function averageFrameArea(frames: PosterFramePlan[]) {
  if (!frames.length) return 0
  return frames.reduce((acc, frame) => acc + frame.width * frame.height, 0) / frames.length
}

function isPlanSimpleSymmetric(frames: PosterFramePlan[], artistCount: number) {
  if (frames.length !== artistCount) return false

  const sorted = [...frames].sort((a, b) => (a.y - b.y) || (a.x - b.x))
  const minHeight = Math.min(...sorted.map(frame => frame.height))
  const rowTolerance = Math.max(0.04, minHeight * 0.35)
  const rows: PosterFramePlan[][] = []

  for (const frame of sorted) {
    const centerY = frame.y + frame.height / 2
    const existing = rows.find((row) => {
      const rowCenter = row[0].y + row[0].height / 2
      return Math.abs(rowCenter - centerY) <= rowTolerance
    })

    if (existing) {
      existing.push(frame)
    } else {
      rows.push([frame])
    }
  }

  for (const row of rows) {
    row.sort((a, b) => a.x - b.x)
  }

  if (artistCount >= 5 && rows.length < 2) return false
  if (artistCount >= 7 && rows.length > 3) return false

  const rowCounts = rows.map(row => row.length)
  const maxRowCount = Math.max(...rowCounts)
  const minRowCount = Math.min(...rowCounts)
  if (rows.length > 1 && maxRowCount - minRowCount > 1) return false

  const yCenters = sorted.map(frame => frame.y + frame.height / 2)
  const ySpread = Math.max(...yCenters) - Math.min(...yCenters)
  if (artistCount >= 5 && ySpread < 0.2) return false

  return true
}

function buildSymmetricFallbackFrames(artistCount: number, protectedZones: PosterProtectedZone[], safeBottom: number): PosterFramePlan[] {
  const count = Math.max(1, artistCount)
  const sideMargin = 0.08
  const gapX = 0.02
  const gapY = 0.026

  const defaultColumns = preferredSymmetricColumns(count)

  const candidateColumns = [...new Set([
    defaultColumns,
    Math.min(4, defaultColumns + 1),
    Math.max(1, defaultColumns - 1),
  ])]

  const blockedRanges = mergeRanges([
    ...protectedZones
      .filter(zone => zone.width >= 0.9)
      .map(zone => ({ start: zone.y - 0.01, end: zone.y + zone.height + 0.01 })),
    { start: safeBottom, end: 1 },
  ])

  const verticalBands = buildAvailableVerticalBands(blockedRanges, 0.05, safeBottom)
  let selectedFrames: PosterFramePlan[] | null = null
  let bestScore = -Infinity

  for (const columns of candidateColumns) {
    const rows = Math.ceil(count / columns)
    const frameWidth = (1 - sideMargin * 2 - gapX * (columns - 1)) / columns

    for (const band of verticalBands) {
      const availableHeight = band.end - band.start
      const frameHeight = (availableHeight - gapY * (rows - 1)) / rows
      const minHeight = Math.max(0.13, frameWidth * 0.8)
      if (frameHeight < minHeight) continue

      const usedHeight = frameHeight * rows + gapY * (rows - 1)
      const topMargin = band.start + (availableHeight - usedHeight) / 2
      const candidate = buildCenteredGridFrames({
        count,
        columns,
        frameWidth,
        frameHeight,
        gapX,
        gapY,
        topMargin,
      })

      if (candidate.some(frame => frameOverlapsProtectedZones(frame, protectedZones, 0, 0.012))) {
        continue
      }

      const score = frameWidth * frameHeight - topMargin * 0.02
      if (score > bestScore) {
        bestScore = score
        selectedFrames = candidate
      }
    }
  }

  if (selectedFrames) return selectedFrames

  const columns = defaultColumns
  const rows = Math.ceil(count / columns)
  const bottomMargin = Math.max(0.06, 1 - safeBottom)
  const frameWidth = (1 - sideMargin * 2 - gapX * (columns - 1)) / columns

  let bestFallbackFrames: PosterFramePlan[] | null = null
  let bestPenalty = Number.POSITIVE_INFINITY
  const topMarginCandidates = [0.07, 0.09, 0.11, 0.13]

  for (const topMargin of topMarginCandidates) {
    const frameHeight = (1 - topMargin - bottomMargin - gapY * (rows - 1)) / rows
    if (frameHeight <= 0.11) continue

    const candidate = buildCenteredGridFrames({
      count,
      columns,
      frameWidth,
      frameHeight,
      gapX,
      gapY,
      topMargin,
    })

    const penalty = calculateZoneCollisionPenalty(candidate, protectedZones, 0.012)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      bestFallbackFrames = candidate
    }

    if (penalty <= 0) {
      return candidate
    }
  }

  if (bestFallbackFrames) {
    return bestFallbackFrames
  }

  const emergencyTopMargin = 0.06
  const emergencyFrameHeight = Math.max(0.12, (1 - emergencyTopMargin - bottomMargin - gapY * (rows - 1)) / rows)
  return buildCenteredGridFrames({
    count,
    columns,
    frameWidth,
    frameHeight: emergencyFrameHeight,
    gapX,
    gapY,
    topMargin: emergencyTopMargin,
  })
}

function preferredSymmetricColumns(count: number) {
  if (count <= 1) return 1
  if (count <= 4) return 2
  if (count <= 6) return 3
  if (count <= 8) return 4
  if (count <= 12) return 3
  return 4
}

function getPosterSafeBottomLimit(artistCount: number) {
  if (artistCount >= 11) return 0.74
  if (artistCount >= 9) return 0.71
  return 0.68
}

function buildCenteredGridFrames(input: {
  count: number
  columns: number
  frameWidth: number
  frameHeight: number
  gapX: number
  gapY: number
  topMargin: number
}): PosterFramePlan[] {
  const {
    count,
    columns,
    frameWidth,
    frameHeight,
    gapX,
    gapY,
    topMargin,
  } = input
  const rows = Math.ceil(count / columns)

  const frames: PosterFramePlan[] = []

  let index = 0
  for (let row = 0; row < rows; row += 1) {
    const remaining = count - index
    const rowCount = Math.min(columns, remaining)
    const rowWidth = rowCount * frameWidth + (rowCount - 1) * gapX
    const rowStartX = (1 - rowWidth) / 2
    const y = topMargin + row * (frameHeight + gapY)

    for (let col = 0; col < rowCount; col += 1) {
      frames.push({
        x: rowStartX + col * (frameWidth + gapX),
        y,
        width: frameWidth,
        height: frameHeight,
        labelRatio: 0.23,
        fontScale: 0.105,
      })
      index += 1
    }
  }

  return frames
}

async function detectTemplateProtectedZones(templateBuffer: Buffer): Promise<PosterProtectedZone[]> {
  const baselineZones: PosterProtectedZone[] = [
    { x: 0, y: 0, width: 1, height: 0.08 },
    { x: 0, y: 0.76, width: 1, height: 0.24 },
  ]

  try {
    const width = 360
    const height = 540
    const tileSize = 12
    const { data, info } = await sharp(templateBuffer, { animated: false })
      .rotate()
      .toColorspace('srgb')
      .removeAlpha()
      .resize({ width, height, fit: 'fill', withoutEnlargement: false })
      .raw()
      .toBuffer({ resolveWithObject: true })

    const channels = info.channels
    if (!channels || channels < 3) {
      return mergeProtectedZones(baselineZones)
    }

    const cornerScore = new Float32Array(width * height)
    const rowTotals = new Float32Array(height)

    for (let y = 1; y < height; y += 1) {
      let rowSum = 0
      for (let x = 1; x < width; x += 1) {
        const idx = (y * width + x) * channels
        const leftIdx = (y * width + (x - 1)) * channels
        const upIdx = ((y - 1) * width + x) * channels

        const lum = luminanceAt(data, idx)
        const lumLeft = luminanceAt(data, leftIdx)
        const lumUp = luminanceAt(data, upIdx)
        const gx = Math.abs(lum - lumLeft)
        const gy = Math.abs(lum - lumUp)
        const sat = saturationAt(data, idx)
        const score = Math.min(gx, gy) * 0.78 + sat * 120

        const position = y * width + x
        cornerScore[position] = score
        rowSum += score
      }
      rowTotals[y] = rowSum / Math.max(1, width - 1)
    }

    const smoothedRows = smoothFloatArray(rowTotals, 4)
    const rowMean = meanFloatArray(smoothedRows)
    const rowStd = stdDevFloatArray(smoothedRows, rowMean)
    const rowThreshold = rowMean + rowStd * 1.35
    const rowSegments = extractRowSegments(smoothedRows, rowThreshold, Math.max(7, Math.round(height * 0.02)))

    const contentZones: PosterProtectedZone[] = []
    for (const segment of rowSegments) {
      const yStart = clampNumber(segment.start / height - 0.012, 0, 0.98)
      const yEnd = clampNumber((segment.end + 1) / height + 0.012, yStart + 0.02, 1)
      contentZones.push({ x: 0, y: yStart, width: 1, height: yEnd - yStart })
    }

    const cellsX = Math.floor(width / tileSize)
    const cellsY = Math.floor(height / tileSize)
    const cellScores: number[] = []
    const grid: number[][] = Array.from({ length: cellsY }, () => Array(cellsX).fill(0))

    for (let cellY = 0; cellY < cellsY; cellY += 1) {
      for (let cellX = 0; cellX < cellsX; cellX += 1) {
        let sum = 0
        const startX = cellX * tileSize
        const startY = cellY * tileSize
        for (let y = startY; y < startY + tileSize; y += 1) {
          for (let x = startX; x < startX + tileSize; x += 1) {
            sum += cornerScore[y * width + x]
          }
        }
        const avg = sum / (tileSize * tileSize)
        grid[cellY][cellX] = avg
        cellScores.push(avg)
      }
    }

    const cellMean = cellScores.reduce((acc, value) => acc + value, 0) / Math.max(1, cellScores.length)
    const cellVariance = cellScores.reduce((acc, value) => acc + (value - cellMean) ** 2, 0) / Math.max(1, cellScores.length)
    const cellStd = Math.sqrt(cellVariance)
    const cellThreshold = cellMean + cellStd * 1.15
    const hotMask = grid.map((row) => row.map((score) => score >= cellThreshold))
    const components = findHotComponents(hotMask)

    for (const component of components) {
      if (component.count < 4) continue

      const xStart = clampNumber((component.minX * tileSize) / width - 0.012, 0, 0.98)
      const yStart = clampNumber((component.minY * tileSize) / height - 0.012, 0, 0.98)
      const xEnd = clampNumber(((component.maxX + 1) * tileSize) / width + 0.012, xStart + 0.02, 1)
      const yEnd = clampNumber(((component.maxY + 1) * tileSize) / height + 0.012, yStart + 0.02, 1)

      const zone: PosterProtectedZone = {
        x: xStart,
        y: yStart,
        width: xEnd - xStart,
        height: yEnd - yStart,
      }

      if (zone.width * zone.height < 0.004) continue
      if (zone.width > 0.9 && zone.height > 0.45) continue

      contentZones.push(zone)
    }

    return mergeProtectedZones([...baselineZones, ...contentZones])
  } catch (error) {
    console.warn('[Poster] Protected-zone detection fallback to baseline:', error)
    return mergeProtectedZones(baselineZones)
  }
}

function luminanceAt(data: Buffer, index: number) {
  const r = data[index] ?? 0
  const g = data[index + 1] ?? 0
  const b = data[index + 2] ?? 0
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function saturationAt(data: Buffer, index: number) {
  const r = (data[index] ?? 0) / 255
  const g = (data[index + 1] ?? 0) / 255
  const b = (data[index + 2] ?? 0) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max <= 0) return 0
  return (max - min) / max
}

function smoothFloatArray(values: Float32Array, radius: number) {
  if (radius <= 0) return values

  const output = new Float32Array(values.length)
  for (let i = 0; i < values.length; i += 1) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j += 1) {
      sum += values[j]
      count += 1
    }
    output[i] = count > 0 ? sum / count : values[i]
  }
  return output
}

function meanFloatArray(values: Float32Array) {
  if (!values.length) return 0
  return values.reduce((acc, value) => acc + value, 0) / values.length
}

function stdDevFloatArray(values: Float32Array, mean: number) {
  if (!values.length) return 0
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function extractRowSegments(values: Float32Array, threshold: number, minLength: number) {
  const segments: Array<{ start: number; end: number }> = []
  let start = -1

  for (let i = 0; i < values.length; i += 1) {
    if (values[i] >= threshold) {
      if (start < 0) start = i
      continue
    }

    if (start >= 0) {
      const end = i - 1
      if (end - start + 1 >= minLength) {
        segments.push({ start, end })
      }
      start = -1
    }
  }

  if (start >= 0) {
    const end = values.length - 1
    if (end - start + 1 >= minLength) {
      segments.push({ start, end })
    }
  }

  return segments
}

function findHotComponents(mask: boolean[][]) {
  const rows = mask.length
  const cols = rows > 0 ? mask[0].length : 0
  const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false))
  const components: Array<{ minX: number; minY: number; maxX: number; maxY: number; count: number }> = []

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!mask[y][x] || visited[y][x]) continue

      let minX = x
      let minY = y
      let maxX = x
      let maxY = y
      let count = 0
      const queue: Array<[number, number]> = [[x, y]]
      visited[y][x] = true

      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!
        count += 1
        minX = Math.min(minX, cx)
        minY = Math.min(minY, cy)
        maxX = Math.max(maxX, cx)
        maxY = Math.max(maxY, cy)

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
            if (visited[ny][nx] || !mask[ny][nx]) continue
            visited[ny][nx] = true
            queue.push([nx, ny])
          }
        }
      }

      components.push({ minX, minY, maxX, maxY, count })
    }
  }

  return components
}

function mergeProtectedZones(zones: PosterProtectedZone[]): PosterProtectedZone[] {
  const normalized = zones
    .map(zone => ({
      x: clampNumber(zone.x, 0, 1),
      y: clampNumber(zone.y, 0, 1),
      width: clampNumber(zone.width, 0.02, 1),
      height: clampNumber(zone.height, 0.02, 1),
    }))
    .map(zone => ({
      ...zone,
      width: Math.min(zone.width, 1 - zone.x),
      height: Math.min(zone.height, 1 - zone.y),
    }))
    .filter(zone => zone.width > 0 && zone.height > 0)
    .sort((a, b) => a.y - b.y)

  if (!normalized.length) return []

  const merged: PosterProtectedZone[] = [normalized[0]]
  for (let i = 1; i < normalized.length; i += 1) {
    const current = normalized[i]
    const previous = merged[merged.length - 1]
    const previousEnd = previous.y + previous.height
    if (current.y <= previousEnd + 0.015 && current.x <= previous.x + previous.width && previous.x <= current.x + current.width) {
      const newEnd = Math.max(previousEnd, current.y + current.height)
      previous.y = Math.min(previous.y, current.y)
      previous.height = newEnd - previous.y
      previous.x = Math.min(previous.x, current.x)
      previous.width = Math.max(previous.x + previous.width, current.x + current.width) - previous.x
      continue
    }

    merged.push(current)
  }

  return merged.slice(0, 6)
}

function buildAvailableVerticalBands(ranges: Array<{ start: number; end: number }>, minY: number, maxY: number) {
  const bands: Array<{ start: number; end: number }> = []
  const normalized = mergeRanges(ranges)
  let cursor = minY

  for (const range of normalized) {
    const start = clampNumber(range.start, minY, maxY)
    const end = clampNumber(range.end, minY, maxY)
    if (start > cursor + 0.03) {
      bands.push({ start: cursor, end: start })
    }
    cursor = Math.max(cursor, end)
  }

  if (cursor < maxY - 0.03) {
    bands.push({ start: cursor, end: maxY })
  }

  return bands
}

function mergeRanges(ranges: Array<{ start: number; end: number }>) {
  const normalized = ranges
    .map(range => ({
      start: clampNumber(range.start, 0, 1),
      end: clampNumber(range.end, 0, 1),
    }))
    .filter(range => range.end > range.start)
    .sort((a, b) => a.start - b.start)

  if (!normalized.length) return []

  const merged: Array<{ start: number; end: number }> = [normalized[0]]
  for (let i = 1; i < normalized.length; i += 1) {
    const current = normalized[i]
    const previous = merged[merged.length - 1]
    if (current.start <= previous.end + 0.001) {
      previous.end = Math.max(previous.end, current.end)
      continue
    }
    merged.push(current)
  }

  return merged
}

function frameOverlapsProtectedZones(frame: PosterFramePlan, zones: PosterProtectedZone[], thresholdRatio: number, safetyPad = 0) {
  const paddedFrame = {
    x: clampNumber(frame.x - safetyPad, 0, 1),
    y: clampNumber(frame.y - safetyPad, 0, 1),
    width: clampNumber(frame.width + safetyPad * 2, 0.02, 1),
    height: clampNumber(frame.height + safetyPad * 2, 0.02, 1),
  }
  paddedFrame.width = Math.min(paddedFrame.width, 1 - paddedFrame.x)
  paddedFrame.height = Math.min(paddedFrame.height, 1 - paddedFrame.y)

  for (const zone of zones) {
    const left = Math.max(paddedFrame.x, zone.x)
    const top = Math.max(paddedFrame.y, zone.y)
    const right = Math.min(paddedFrame.x + paddedFrame.width, zone.x + zone.width)
    const bottom = Math.min(paddedFrame.y + paddedFrame.height, zone.y + zone.height)
    if (right <= left || bottom <= top) continue

    const overlapArea = (right - left) * (bottom - top)
    const frameArea = paddedFrame.width * paddedFrame.height
    if (overlapArea / frameArea > thresholdRatio) {
      return true
    }
  }

  return false
}

function calculateZoneCollisionPenalty(frames: PosterFramePlan[], zones: PosterProtectedZone[], safetyPad = 0) {
  let penalty = 0

  for (const frame of frames) {
    const padded = {
      x: clampNumber(frame.x - safetyPad, 0, 1),
      y: clampNumber(frame.y - safetyPad, 0, 1),
      width: clampNumber(frame.width + safetyPad * 2, 0.02, 1),
      height: clampNumber(frame.height + safetyPad * 2, 0.02, 1),
    }
    padded.width = Math.min(padded.width, 1 - padded.x)
    padded.height = Math.min(padded.height, 1 - padded.y)

    const area = padded.width * padded.height
    if (area <= 0) continue

    for (const zone of zones) {
      const left = Math.max(padded.x, zone.x)
      const top = Math.max(padded.y, zone.y)
      const right = Math.min(padded.x + padded.width, zone.x + zone.width)
      const bottom = Math.min(padded.y + padded.height, zone.y + zone.height)
      if (right <= left || bottom <= top) continue

      const overlap = (right - left) * (bottom - top)
      penalty += overlap / area
    }
  }

  return penalty
}

function formatProtectedZonesForPrompt(zones: PosterProtectedZone[]) {
  if (!zones.length) return 'none'

  return zones
    .slice(0, 6)
    .map((zone) => {
      const yStart = zone.y.toFixed(3)
      const yEnd = (zone.y + zone.height).toFixed(3)
      return `y:${yStart}-${yEnd}`
    })
    .join(', ')
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) {
      return text.slice(start, i + 1)
    }
  }

  return null
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
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

async function buildPosterDesignReference(template: PosterDesignTemplateInput | null | undefined): Promise<PosterDesignReference | null> {
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
      promptLine: `Input image {index} = reference poster "${label}". This file is immutable Layer 1. Preserve it exactly and only replace comedian photos, names, title, date, time, and venue inside existing slots. Do not add overlays or new frames on top.`,
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

