/**
 * Hva et godkjent headshot er — én liste, brukt både i guiden komikeren ser og
 * i vurderingen AI-en gjør (`lib/headshot-check.ts`). Bildet havner på
 * plakater, så kravene er de plakaten trenger: én person, ansiktet synlig,
 * skarpt nok til å trykkes.
 *
 * Ingen Node-avhengigheter: guiden i skjemaet importerer herfra.
 */

export const HEADSHOT_EXAMPLE_SRC = '/headshot-example.jpg'

/** Det komikeren leser før de velger bilde. Kort — de skal skumme, ikke lese. */
export const HEADSHOT_RULES = [
  'Only you in the photo',
  'Your face clearly visible',
  'Sharp and well lit',
  'Upper body in frame, like the example',
] as const

/** Grunnene AI-en kan avvise på. Teksten er vår, ikke modellens. */
export const HEADSHOT_PROBLEMS = {
  multiple_people: 'There is more than one person in this photo. Choose one where it is only you.',
  no_person: 'We could not find a person in this photo. Choose a photo of yourself.',
  face_hidden: 'Your face is hard to see. Choose a photo where it is clearly visible.',
  blurry: 'The photo is blurry. Choose a sharper one.',
  too_dark: 'The photo is too dark. Choose one with better light.',
  too_far: 'You are too far away. Choose a photo that shows your upper body.',
  cropped: 'Your head is cut off. Choose a photo where your whole head is in the frame.',
  not_a_photo: 'This looks like a graphic, not a photo. Choose a real photo of yourself.',
  text_overlay: 'The photo has text or logos on it. Choose one without.',
} as const

export type HeadshotProblem = keyof typeof HEADSHOT_PROBLEMS

export type HeadshotVerdict =
  | { approved: true; token: string }
  | { approved: false; problem: HeadshotProblem }

export function isHeadshotProblem(value: unknown): value is HeadshotProblem {
  return typeof value === 'string' && value in HEADSHOT_PROBLEMS
}
