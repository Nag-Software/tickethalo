import { getOpenAI } from '@/lib/openai'
import sharp from 'sharp'

export async function validateFrameBackgroundImage(buffer: Buffer) {
  try {
    const previewBuffer = await sharp(buffer, { animated: false })
      .rotate()
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
          content: [
            {
              type: 'input_text',
              text: 'You inspect poster background images. Return JSON only.',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                'Does this image contain any of the following?',
                '- visible human faces or portrait photos',
                '- comedian or person names as text',
                '- show-specific text such as titles, dates, venues, or ticket info',
                '',
                'Return JSON: {"hasPeopleOrText": boolean, "reason": "short Norwegian explanation"}',
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

    const jsonBlock = response.output_text?.match(/\{[\s\S]*\}/)?.[0]
    if (!jsonBlock) {
      console.warn('[poster-validation] model returned no JSON block; allowing background')
      return { ok: true as const }
    }

    const parsed = JSON.parse(jsonBlock) as { hasPeopleOrText?: boolean; reason?: string }
    if (parsed.hasPeopleOrText) {
      return {
        ok: false as const,
        reason: parsed.reason?.trim()
          || 'Ramme-bakgrunn kan ikke inneholde personer eller tekst. Last opp et rent design, eller bruk AI-plakat med referanse.',
      }
    }

    return { ok: true as const }
  } catch (error) {
    // This is a non-blocking quality gate, not a security control. An OpenAI
    // outage, network error, or unparseable response must NOT crash the whole
    // upload action (it previously threw straight out of JSON.parse / the API
    // call). Fail open so admins can keep uploading, but log it so silent gate
    // failures are visible — the admin still reviews the rendered poster.
    console.error('[poster-validation] frame background validation failed:', error)
    return { ok: true as const }
  }
}
