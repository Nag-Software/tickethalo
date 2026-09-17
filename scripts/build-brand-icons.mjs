/**
 * Bygger de to ikonfilene som ikke kan leveres som rene PNG-er:
 *
 *   public/logo/icon.svg        faviconen — bytter mellom lys og mørk variant
 *   public/logo/apple-icon.png  iOS-hjemskjermikon — trenger ugjennomsiktig bunn
 *
 * Kildene er designfilene i public/logo/{light,dark}/icon.png. Kjør dette på
 * nytt når de byttes ut:
 *
 *   node scripts/build-brand-icons.mjs
 *
 * Hvorfor faviconen er en SVG og ikke bare to <link rel="icon" media="...">:
 * media-attributtet på ikonlenker leses ikke av alle nettlesere, og de som
 * hopper over det plukker «det beste» ikonet — altså like gjerne den hvite
 * varianten på en lys skjerm. En SVG med `prefers-color-scheme` inni gjør
 * valget inne i selve filen, og det virker i Chrome, Edge og Firefox.
 * PNG-ene ligger fortsatt i <head> som fallback (se app/layout.tsx).
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = path.join(import.meta.dirname, '..')
const logoDir = path.join(root, 'public', 'logo')

/** Grunnfargen på de offentlige flatene — `--ev-bg` i app/globals.css.
 *  Bakt inn her fordi et PNG ikke kan lese en CSS-variabel. Endres den der,
 *  endres den her og filen bygges på nytt. */
const EV_BG = '#fdf4ed'

const [lightIcon, darkIcon] = await Promise.all([
  readFile(path.join(logoDir, 'light', 'icon.png')),
  readFile(path.join(logoDir, 'dark', 'icon.png')),
])

// ── favicon ────────────────────────────────────────────────────────────────
// Merket er tegnet helt ut til kanten av sin egen rute. I en fane på 16px er
// det riktig: ikonet skal fylle plassen det får.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 210" width="210" height="210">
  <!-- Generert av scripts/build-brand-icons.mjs — ikke rediger for hånd. -->
  <style>
    .on-dark { display: none; }
    @media (prefers-color-scheme: dark) {
      .on-light { display: none; }
      .on-dark { display: inline; }
    }
  </style>
  <image class="on-light" width="210" height="210" href="data:image/png;base64,${lightIcon.toString('base64')}"/>
  <image class="on-dark" width="210" height="210" href="data:image/png;base64,${darkIcon.toString('base64')}"/>
</svg>
`

await writeFile(path.join(logoDir, 'icon.svg'), svg)

// ── apple-touch-icon ───────────────────────────────────────────────────────
// iOS legger ikke inn noen bunn selv: et gjennomsiktig ikon havner på svart.
// Derfor komponeres merket på cream her, med luft rundt slik at det tåler
// avrundingen iOS legger på.
const APPLE = 180
const MARK = 116

const mark = await sharp(lightIcon).resize(MARK, MARK).png().toBuffer()

await sharp({
  create: {
    width: APPLE,
    height: APPLE,
    channels: 4,
    background: EV_BG,
  },
})
  .composite([{ input: mark, gravity: 'centre' }])
  .png()
  .toFile(path.join(logoDir, 'apple-icon.png'))

console.log('Skrev public/logo/icon.svg og public/logo/apple-icon.png')
