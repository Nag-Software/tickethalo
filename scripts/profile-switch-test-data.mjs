#!/usr/bin/env node
// Testdata for profilbyttet klubb ↔ komiker (lib/comedian-link.ts).
//
//   node scripts/profile-switch-test-data.mjs create
//   node scripts/profile-switch-test-data.mjs delete
//
// Det finnes bare én Supabase (produksjon), så alt her er merket TEST og
// bruker @example.com-adresser, der ingen e-post kommer frem. `create` lager
// klubben «TEST Profilbytte», en klubbinnlogging (owner) og en komiker med
// egen innlogging. Passordene genereres og skrives til
// `.env.profile-switch-test.local` (gitignorert) — aldri i git eller chat.
// `delete` fjerner alt igjen, også innlogginger som ble laget underveis
// (`profilbytte-…@example.com`, f.eks. ved «Disconnect»).

import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CREDENTIALS_FILE = join(ROOT, '.env.profile-switch-test.local')
const CLUB_SLUG = 'test-profilbytte'
const EMAIL_PREFIX = 'profilbytte-'
const CLUB_EMAIL = `${EMAIL_PREFIX}club@example.com`
const COMEDIAN_EMAIL = `${EMAIL_PREFIX}comedian@example.com`

function loadEnv() {
  const text = readFileSync(join(ROOT, '.env.local'), 'utf8')
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
}

function password() {
  return `${randomBytes(12).toString('base64url')}-Aa1`
}

async function must(promise, what) {
  const { data, error } = await promise
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

async function create(db) {
  if (existsSync(CREDENTIALS_FILE)) throw new Error(`${CREDENTIALS_FILE} finnes alt — kjør delete først.`)

  const club = await must(
    db.from('clubs').insert({ name: 'TEST Profilbytte', slug: CLUB_SLUG, city: 'Oslo' }).select('id').single(),
    'klubb',
  )

  const clubPassword = password()
  const clubUser = await must(
    db.auth.admin.createUser({ email: CLUB_EMAIL, password: clubPassword, email_confirm: true }),
    'klubbinnlogging',
  )
  const clubProfile = await must(
    db.from('profiles')
      .insert({ auth_user_id: clubUser.user.id, email: CLUB_EMAIL, full_name: 'TEST Klubbeier', role: 'owner' })
      .select('id')
      .single(),
    'klubbprofil',
  )
  await must(db.from('club_memberships').insert({ club_id: club.id, profile_id: clubProfile.id }), 'medlemskap')

  const comedianPassword = password()
  const comedianUser = await must(
    db.auth.admin.createUser({ email: COMEDIAN_EMAIL, password: comedianPassword, email_confirm: true }),
    'komikerinnlogging',
  )
  await must(
    db.from('profiles').insert({ auth_user_id: comedianUser.user.id, email: COMEDIAN_EMAIL, full_name: 'TEST Komiker', role: 'artist' }),
    'komikerprofil',
  )
  await must(
    db.from('artists').insert({
      auth_user_id: comedianUser.user.id,
      full_name: 'TEST Komiker',
      stage_name: 'TEST Komiker',
      email: COMEDIAN_EMAIL,
      city: 'Oslo',
      country: 'NO',
      status: 'approved',
    }),
    'komikerrad',
  )

  writeFileSync(
    CREDENTIALS_FILE,
    [
      '# Testinnlogginger for profilbyttet. Laget av scripts/profile-switch-test-data.mjs.',
      `PROFILE_SWITCH_CLUB_EMAIL=${CLUB_EMAIL}`,
      `PROFILE_SWITCH_CLUB_PASSWORD=${clubPassword}`,
      `PROFILE_SWITCH_COMEDIAN_EMAIL=${COMEDIAN_EMAIL}`,
      `PROFILE_SWITCH_COMEDIAN_PASSWORD=${comedianPassword}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  )
  console.log(`Laget. Innloggingene står i ${CREDENTIALS_FILE}.`)
}

async function remove(db) {
  const testUsers = []
  for (let page = 1; ; page++) {
    const { users } = await must(db.auth.admin.listUsers({ page, perPage: 1000 }), 'brukerliste')
    testUsers.push(...users.filter((user) => user.email?.startsWith(EMAIL_PREFIX) && user.email.endsWith('@example.com')))
    if (users.length < 1000) break
  }
  const ids = testUsers.map((user) => user.id)

  // Komikerradene først: `auth_user_id` settes til null når brukeren slettes,
  // og da finner vi dem ikke igjen.
  if (ids.length > 0) {
    await must(db.from('artists').delete().in('auth_user_id', ids), 'komikerrader')
    await must(db.from('artists').delete().in('linked_from_auth_user_id', ids), 'koblede komikerrader')
  }
  await must(db.from('artists').delete().like('email', `${EMAIL_PREFIX}%@example.com`), 'komikerrader på e-post')

  const club = await must(db.from('clubs').select('id').eq('slug', CLUB_SLUG).maybeSingle(), 'klubb')
  if (club) await must(db.from('clubs').delete().eq('id', club.id), 'klubb')

  for (const user of testUsers) await must(db.auth.admin.deleteUser(user.id), `bruker ${user.email}`)

  if (existsSync(CREDENTIALS_FILE)) rmSync(CREDENTIALS_FILE)
  console.log(`Slettet ${testUsers.length} testinnlogging(er)${club ? ' og klubben' : ''}.`)
}

loadEnv()
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const command = process.argv[2]
if (command === 'create') await create(db)
else if (command === 'delete') await remove(db)
else {
  console.error('Bruk: node scripts/profile-switch-test-data.mjs create|delete')
  process.exit(1)
}
