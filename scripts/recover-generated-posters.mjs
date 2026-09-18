// Henter fram AI-plakatene som «forsvant» før plakatarkivet fantes.
//
// Den gamle genereringen lastet hver plakat opp som
// `generated-posters/<showId>/poster-<tidsstempel>.png` og overskrev så
// `shows.poster_url`. Filene ble aldri slettet — det fantes bare ingen rad som
// pekte på dem. Dette skriptet lager de radene.
//
// For hver fil: kopier til `show-marketing-designs/<showId>/posters/` (samme
// bøtte som alle andre plakater, så sletting og gjenbruk virker likt), og sett
// inn en `kind = 'poster'`-rad med tidspunktet fra filnavnet. Plakaten som er i
// bruk på showet får samme URL som før — `shows.poster_url` røres ikke.
//
// Bruk:
//   node scripts/recover-generated-posters.mjs            — tørrkjøring, viser hva som ville skjedd
//   node scripts/recover-generated-posters.mjs --apply    — gjør det
//
// Trygt å kjøre flere ganger: filer som allerede har en arkivrad hoppes over.
// Krever migrasjon 062 og NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// i .env.local.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_BUCKET = 'generated-posters'
const TARGET_BUCKET = 'show-marketing-designs'
const APPLY = process.argv.includes('--apply')

function loadEnvLocal() {
  let text
  try {
    text = readFileSync(join(ROOT, '.env.local'), 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value
  }
}

loadEnvLocal()
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Mangler NEXT_PUBLIC_SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY i .env.local.')
  process.exit(1)
}

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

async function listAll(bucket, prefix) {
  const entries = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 100, offset })
    if (error) throw new Error(`Kunne ikke liste ${bucket}/${prefix}: ${error.message}`)
    entries.push(...(data ?? []))
    if (!data || data.length < 100) return entries
  }
}

const folders = (await listAll(SOURCE_BUCKET, '')).filter((entry) => entry.id === null)
let recovered = 0
let skipped = 0

for (const folder of folders) {
  const showId = folder.name
  const { data: show } = await db.from('shows').select('id, club_id, title, poster_url').eq('id', showId).maybeSingle()
  if (!show) {
    console.log(`– ${showId}: showet finnes ikke lenger, hopper over`)
    continue
  }

  const files = (await listAll(SOURCE_BUCKET, showId)).filter((entry) => /^poster-\d+\.png$/.test(entry.name))
  const { data: existing } = await db
    .from('show_marketing_designs')
    .select('file_name')
    .eq('show_id', showId)
    .eq('kind', 'poster')
  const known = new Set((existing ?? []).map((row) => row.file_name))

  for (const file of files) {
    if (known.has(file.name)) {
      skipped += 1
      continue
    }

    const createdAt = new Date(Number(file.name.match(/\d+/)[0])).toISOString()
    const sourceUrl = db.storage.from(SOURCE_BUCKET).getPublicUrl(`${showId}/${file.name}`).data.publicUrl
    const inUse = show.poster_url === sourceUrl
    console.log(`${APPLY ? '✓' : '·'} ${show.title} — ${file.name} (${createdAt.slice(0, 16)})${inUse ? ' [i bruk]' : ''}`)
    recovered += 1
    if (!APPLY) continue

    // Plakaten som er i bruk blir liggende der den er: alle offentlige sider
    // peker på den URL-en. De andre flyttes inn i arkivbøtta.
    let fileUrl = sourceUrl
    let filePath = `${showId}/${file.name}`
    if (!inUse) {
      const { data: blob, error: downloadError } = await db.storage.from(SOURCE_BUCKET).download(filePath)
      if (downloadError) {
        console.warn(`  kunne ikke laste ned: ${downloadError.message}`)
        recovered -= 1
        continue
      }
      filePath = `${showId}/posters/${file.name}`
      const { error: uploadError } = await db.storage
        .from(TARGET_BUCKET)
        .upload(filePath, Buffer.from(await blob.arrayBuffer()), { contentType: 'image/png', upsert: true })
      if (uploadError) {
        console.warn(`  kunne ikke kopiere: ${uploadError.message}`)
        recovered -= 1
        continue
      }
      fileUrl = db.storage.from(TARGET_BUCKET).getPublicUrl(filePath).data.publicUrl
    }

    const { error: insertError } = await db.from('show_marketing_designs').insert({
      show_id: showId,
      club_id: show.club_id,
      kind: 'poster',
      source: 'ai',
      label: `${show.title} — gjenopprettet`,
      file_url: fileUrl,
      file_path: filePath,
      file_name: file.name,
      mime_type: 'image/png',
      file_type: 'image',
      file_size: file.metadata?.size ?? null,
      created_at: createdAt,
    })
    if (insertError) {
      console.warn(`  kunne ikke lagre arkivrad: ${insertError.message}`)
      recovered -= 1
    }
  }
}

console.log(`\n${APPLY ? 'Gjenopprettet' : 'Ville gjenopprettet'} ${recovered} plakater. ${skipped} lå allerede i arkivet.`)
if (!APPLY && recovered > 0) console.log('Kjør på nytt med --apply for å gjøre det.')
