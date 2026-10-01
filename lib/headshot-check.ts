import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import sharp from 'sharp'
import { getOpenAI } from '@/lib/openai'
import { HEADSHOT_PROBLEMS, isHeadshotProblem, type HeadshotProblem } from '@/lib/headshot-guide'

/**
 * AI-vurdering av headshotet i registreringsskjemaet.
 *
 * Skjemaet sender bildet hit før innsending. Godkjennes det, får skjemaet en
 * signert kvittering for akkurat de bytene, og innsendingsruten slipper bare
 * gjennom et bilde med gyldig kvittering. Da kjøres modellen én gang per bilde,
 * og svaret komikeren så er det samme som gjelder ved innsending.
 *
 * Feiler modellen (nede, tidsavbrudd), godkjennes bildet. En registrering
 * skal ikke stoppe fordi OpenAI har en dårlig dag — bookingteamet ser uansett
 * søknaden.
 */

const PROBLEM_CODES = Object.keys(HEADSHOT_PROBLEMS) as HeadshotProblem[]

const PROMPT = `A comedian is uploading the headshot that will be printed on show posters.
Judge whether the photo works for that. Be lenient: only reject on a clear problem. When in doubt, approve.

Approve when:
- exactly one person is the clear subject (a blurred audience far in the background is fine),
- their face is visible and recognisable (a microphone in front of the chin is fine; glasses are fine),
- the photo is reasonably sharp and lit well enough to see the face,
- the framing is anywhere from head-and-shoulders to about the knees, with the whole head in the frame,
- it is a real photograph. Stage photos, studio photos and plain backgrounds are all fine.

Set problem to "none" when approving. Otherwise reject with the single most important problem:
- multiple_people: two or more people share the frame as subjects,
- no_person: no person in the photo,
- face_hidden: the face is turned away, covered, in deep shadow or too small to recognise,
- blurry: clearly out of focus or motion-blurred,
- too_dark: too dark to see the face properly,
- too_far: the person is small in a wide shot (full body far away),
- cropped: the top of the head or part of the face is cut off by the edge,
- not_a_photo: a drawing, logo, poster, screenshot or AI-looking illustration,
- text_overlay: text, logos or graphics are placed on top of the photo.`

export async function judgeHeadshot(image: Buffer): Promise<{ approved: true } | { approved: false; problem: HeadshotProblem }> {
  try {
    const preview = await sharp(image)
      .rotate()
      .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer()

    const response = await getOpenAI().responses.create(
      {
        model: 'gpt-5-mini',
        reasoning: { effort: 'low' },
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: PROMPT },
            { type: 'input_image', image_url: `data:image/jpeg;base64,${preview.toString('base64')}`, detail: 'low' },
          ],
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'headshot_check',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                approved: { type: 'boolean' },
                problem: { type: 'string', enum: ['none', ...PROBLEM_CODES] },
              },
              required: ['approved', 'problem'],
              additionalProperties: false,
            },
          },
        },
      },
      { timeout: 25_000 },
    )

    const parsed = JSON.parse(response.output_text) as { approved: boolean; problem: unknown }
    if (parsed.approved || !isHeadshotProblem(parsed.problem)) return { approved: true }
    return { approved: false, problem: parsed.problem }
  } catch (error) {
    console.error('Headshot check failed, approving:', error)
    return { approved: true }
  }
}

// ─────────────────────────────────────────────────────────────
// Kvitteringen
// ─────────────────────────────────────────────────────────────

/** Egen nøkkel avledet fra service-nøkkelen — så ingen ny miljøvariabel. */
function signingKey() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return createHmac('sha256', secret).update('headshot-check').digest()
}

function sign(image: Buffer) {
  const digest = createHash('sha256').update(image).digest()
  return createHmac('sha256', signingKey()).update(digest).digest('hex')
}

export function headshotToken(image: Buffer) {
  return sign(image)
}

export function isApprovedHeadshot(image: Buffer, token: string | null | undefined) {
  if (!token) return false
  const expected = Buffer.from(sign(image), 'hex')
  const given = Buffer.from(token, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}
