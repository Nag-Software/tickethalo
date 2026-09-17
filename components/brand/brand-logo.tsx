import Image from 'next/image'

import { cn } from '@/lib/utils'

/**
 * Merket, som bilde. Tidligere var det satt sammen på stedet av en inline
 * SVG og ordet «Tickethalo» i sidens egen skrift — to ting som måtte holdes
 * i synk for hånd, og som så ulikt ut fra side til side.
 *
 * Filene ligger i public/logo. `light` er varianten som brukes *i* lys modus,
 * altså mørkt blekk for en lys flate; `dark` er den hvite, for en mørk flate.
 * Det er samme betydning som `data-tone` på `.ev-surface`, så et kall som
 * står på en mørk pille sender `tone="dark"`.
 *
 * Tonen er en prop og ikke et CSS-bytte på `[data-tone='dark'] &`: et bilde
 * lastes ned selv når elementet er `display:none`, så et CSS-bytte ville
 * hentet begge filene på hver sidelast. Favicon-en er det motsatte tilfellet
 * — den kan ikke se noen prop og gjør valget inne i selve fila. Se
 * scripts/build-brand-icons.mjs.
 */
type Tone = 'light' | 'dark'

const LOCKUP: Record<Tone, string> = {
  light: '/logo/light/logo.png',
  dark: '/logo/dark/logo.png',
}

const MARK: Record<Tone, string> = {
  light: '/logo/light/icon.png',
  dark: '/logo/dark/icon.png',
}

/** Designfilenes egne mål. `images.unoptimized` står på, så next/image bruker
 *  dem kun til å reservere plassen — filen serveres som den er. */
const LOCKUP_SIZE = { width: 1537, height: 399 }
const MARK_SIZE = { width: 210, height: 210 }

type LogoProps = {
  tone?: Tone
  className?: string
  /** Tom streng når merket står ved siden av samme ord i tekst. */
  alt?: string
  priority?: boolean
}

/**
 * Ikon + ordmerke.
 *
 * Størrelsen settes med `className` — `h-6 w-auto` og oppover. Merk at
 * filen har luft over og under blekket (220 av 399 piksler er merket), så
 * `h-6` gir et ordmerke på ~13px, ikke 24.
 */
export function BrandLogo({ tone = 'light', className, alt = 'Tickethalo', priority }: LogoProps) {
  return (
    <Image
      src={LOCKUP[tone]}
      alt={alt}
      {...LOCKUP_SIZE}
      priority={priority}
      className={cn('w-auto', className)}
    />
  )
}

/**
 * Ordmerket, men bare ikonet under 360px — der de 92 pikslene ordmerket
 * trenger ville skjøvet lenkene i headeren ut av skjermen. Det er samme
 * bytte som før, da ordmerket var tekst.
 *
 * `<picture>` og ikke to elementer med `hidden`: et bilde lastes ned selv når
 * det er `display:none`, så to elementer ville hentet begge filene ved hver
 * sidelast. Nettleseren velger én `<source>` og henter bare den. Samme grep
 * som i home-hero.tsx, og next/image ville uansett ikke gjort noe her —
 * `images.unoptimized` står på.
 */
export function BrandLogoResponsive({ tone = 'light', className, alt = 'Tickethalo', priority }: LogoProps) {
  return (
    <picture>
      <source
        media="(max-width: 359px)"
        srcSet={MARK[tone]}
        width={MARK_SIZE.width}
        height={MARK_SIZE.height}
      />
      <img
        src={LOCKUP[tone]}
        alt={alt}
        {...LOCKUP_SIZE}
        fetchPriority={priority ? 'high' : undefined}
        className={cn('w-auto', className)}
      />
    </picture>
  )
}

/** Bare ikonet — der ordmerket ikke får plass, som i en rund eller kvadratisk flate. */
export function BrandMark({ tone = 'light', className, alt = '', priority }: LogoProps) {
  return (
    <Image
      src={MARK[tone]}
      alt={alt}
      {...MARK_SIZE}
      priority={priority}
      className={cn('object-contain', className)}
    />
  )
}
