import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The font we bundle in public/fonts and composite poster text with. The "Geist"
// family file ships Regular (400) + Bold (700) and covers full Latin incl. æ ø å.
// Geist Medium / SemiBold are separate families (see public/fonts) if ever needed.
export const POSTER_FONT_FAMILY = 'Geist'

let configured = false

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * Register the bundled poster font with fontconfig so sharp/librsvg can render
 * SVG <text> deterministically.
 *
 * WHY THIS EXISTS: the poster SVG text used to rely on the host's "Arial" font.
 * Vercel / AWS Lambda images ship NO Arial (and no fallback sans-serif at all),
 * so every <text> element rendered as empty tofu boxes in production. We bundle
 * Geist under public/fonts and point fontconfig at it via a generated config in
 * a writable temp dir (only /tmp is writable on Lambda). Aliasing sans-serif /
 * Arial / Helvetica → Geist means existing font-family strings resolve too.
 *
 * Idempotent and safe to call before every render. Must run BEFORE the first
 * sharp text rasterization in the process, because fontconfig caches its config
 * on first use.
 */
export function ensurePosterFonts() {
  if (configured) return
  configured = true

  try {
    const fontsDir = path.join(process.cwd(), 'public', 'fonts')
    const cacheDir = path.join(os.tmpdir(), 'humor-fontconfig')
    mkdirSync(cacheDir, { recursive: true })

    const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>${escapeXml(fontsDir)}</dir>
  <cachedir>${escapeXml(cacheDir)}</cachedir>
  <alias><family>sans-serif</family><prefer><family>${POSTER_FONT_FAMILY}</family></prefer></alias>
  <alias><family>Arial</family><prefer><family>${POSTER_FONT_FAMILY}</family></prefer></alias>
  <alias><family>Helvetica</family><prefer><family>${POSTER_FONT_FAMILY}</family></prefer></alias>
</fontconfig>
`
    const confPath = path.join(cacheDir, 'fonts.conf')
    writeFileSync(confPath, conf, 'utf8')

    // FONTCONFIG_FILE wins over the (absent) system config. FONTCONFIG_PATH is a
    // belt-and-suspenders for builds that read a dir instead of a file.
    process.env.FONTCONFIG_FILE = confPath
    process.env.FONTCONFIG_PATH = cacheDir
  } catch (err) {
    console.warn('[Poster] Could not configure bundled fonts; text may fall back:', err)
  }
}
