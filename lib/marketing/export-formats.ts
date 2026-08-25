import type { MarketingExportFormat } from '@/types/database'

/**
 * De ferdige filene klubben trenger for å markedsføre showet.
 *
 * Bare formatbeskrivelsene ligger her, uten sharp: admin-flaten viser de samme
 * målene i forhåndsvisningen, og en klientkomponent kan ikke importere Node.
 *
 * Plakaten er alltid 2:3 stående. Ingen av kanalene vil ha 2:3: Facebook vil
 * ha et bredt cover, Instagram vil ha 4:5, og trykk vil ha A-format. Derfor
 * er dette en ren omformingsfil — plakaten er kilden, og hvert format er en
 * beskjæring eller en innramming av den.
 *
 * `fit`-valget per format er poenget:
 *   * `cover` der formatet er nær 2:3 (A4, A3, 4:5) — beskjæringen er liten,
 *     og designet skal gå helt ut i kanten.
 *   * `blur` der formatet er langt unna (bredt cover, 9:16 story) — plakaten
 *     vises hel oppå en uskarp forstørrelse av seg selv, i stedet for å bli
 *     beskåret i stykker eller lagt på en flat farge som ikke finnes i designet.
 */

export type MarketingExportSpec = {
  format: MarketingExportFormat
  label: string
  /** Hva klubben faktisk skal bruke filen til. */
  usage: string
  width: number
  height: number
  fit: 'cover' | 'blur'
  /** DPI-merkingen som legges i filen. 300 for trykk, 72 for skjerm. */
  density: number
  /** Trykkfiler blir store — de skal ikke ligge i en Instagram-boks. */
  isPrint: boolean
}

/** 300 dpi: 297×420 mm og 210×297 mm i piksler. */
export const MARKETING_EXPORT_SPECS: MarketingExportSpec[] = [
  {
    format: 'facebook_event',
    label: 'Facebook event',
    usage: 'Coverbildet på Facebook-eventet (1920×1005).',
    width: 1920,
    height: 1005,
    fit: 'blur',
    density: 72,
    isPrint: false,
  },
  {
    format: 'social_post',
    label: 'SoMe post',
    usage: 'Feed-post på Instagram og Facebook (1080×1350).',
    width: 1080,
    height: 1350,
    fit: 'cover',
    density: 72,
    isPrint: false,
  },
  {
    format: 'social_story',
    label: 'SoMe story',
    usage: 'Story og Reels-cover (1080×1920).',
    width: 1080,
    height: 1920,
    fit: 'blur',
    density: 72,
    isPrint: false,
  },
  {
    format: 'print_a4',
    label: 'A4 print',
    usage: 'Trykkeklar A4 i 300 dpi (2480×3508).',
    width: 2480,
    height: 3508,
    fit: 'cover',
    density: 300,
    isPrint: true,
  },
  {
    format: 'print_a3',
    label: 'A3 print',
    usage: 'Trykkeklar A3 i 300 dpi (3508×4961).',
    width: 3508,
    height: 4961,
    fit: 'cover',
    density: 300,
    isPrint: true,
  },
]

export function exportSpec(format: string): MarketingExportSpec | null {
  return MARKETING_EXPORT_SPECS.find((spec) => spec.format === format) ?? null
}

export function isMarketingExportFormat(value: unknown): value is MarketingExportFormat {
  return typeof value === 'string' && MARKETING_EXPORT_SPECS.some((spec) => spec.format === value)
}
