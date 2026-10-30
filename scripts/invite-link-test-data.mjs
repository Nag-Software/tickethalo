#!/usr/bin/env node
// Testdata for klubbens invitasjonslenke (lib/club-invite.ts).
//
//   node scripts/invite-link-test-data.mjs create
//   node scripts/invite-link-test-data.mjs delete
//
// Det finnes bare én Supabase (produksjon), så alt her er merket TEST og
// bruker @example.com-adresser, der ingen e-post kommer frem. `create` lager
// to klubber — «TEST Invitasjon A» som inviterer og «TEST Invitasjon B» som
// sjekker at komikeren fortsatt står i katalogen — med hver sin
// klubbinnlogging, og en komiker som har konto fra før. Passordene
// genereres og skrives til `.env.invite-link-test.local` (gitignorert) —
// aldri i git eller chat. `delete` fjerner alt igjen, også komikere som
// registrerte seg underveis (`invitasjon-…@example.com`).

import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CREDENTIALS_FILE = join(ROOT, '.env.invite-link-test.local')
const CLUBS = [
  { slug: 'test-invitasjon-a', name: 'TEST Invitasjon A', email: 'invitasjon-club-a@example.com', env: 'CLUB_A' },
  { slug: 'test-invitasjon-b', name: 'TEST Invitasjon B', email: 'invitasjon-club-b@example.com', env: 'CLUB_B' },
]
const EMAIL_PREFIX = 'invitasjon-'
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

  const lines = []
  for (const spec of CLUBS) {
    const club = await must(
      db.from('clubs').insert({ name: spec.name, slug: spec.slug, city: 'Oslo' }).select('id').single(),
      'klubb',
    )
    const clubPassword = password()
    const clubUser = await must(
      db.auth.admin.createUser({ email: spec.email, password: clubPassword, email_confirm: true }),
      'klubbinnlogging',
    )
    const clubProfile = await must(
      db.from('profiles')
        .insert({ auth_user_id: clubUser.user.id, email: spec.email, full_name: `${spec.name} eier`, role: 'owner' })
        .select('id')
        .single(),
      'klubbprofil',
    )
    await must(db.from('club_memberships').insert({ club_id: club.id, profile_id: clubProfile.id }), 'medlemskap')
    lines.push(`INVITE_${spec.env}_EMAIL=${spec.email}`, `INVITE_${spec.env}_PASSWORD=${clubPassword}`)
  }

  const comedianPassword = password()
  const comedianUser = await must(
    db.auth.admin.createUser({ email: COMEDIAN_EMAIL, password: comedianPassword, email_confirm: true }),
    'komikerinnlogging',
  )
  await must(
    db.from('profiles').insert({ auth_user_id: comedianUser.user.id, email: COMEDIAN_EMAIL, full_name: 'TEST Invitert Komiker', role: 'artist' }),
    'komikerprofil',
  )
  await must(
    db.from('artists').insert({
      auth_user_id: comedianUser.user.id,
      full_name: 'TEST Invitert Komiker',
      stage_name: 'TEST Invitert Komiker',
      category: ['headliner'],
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
      '# Testinnlogginger for invitasjonslenken. Laget av scripts/invite-link-test-data.mjs.',
      ...lines,
      `INVITE_COMEDIAN_EMAIL=${COMEDIAN_EMAIL}`,
      `INVITE_COMEDIAN_PASSWORD=${comedianPassword}`,
      `INVITE_NEW_COMEDIAN_EMAIL=${EMAIL_PREFIX}new@example.com`,
      `INVITE_NEW_COMEDIAN_PASSWORD=${password()}`,
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
  // og da finner vi dem ikke igjen. Headshoten fra registreringen ligger i
  // lagringen og forsvinner ikke med raden.
  if (ids.length > 0) {
    const artists = await must(db.from('artists').select('profile_image_url').in('auth_user_id', ids), 'headshots')
    const paths = artists
      .map((artist) => artist.profile_image_url?.split('/artist-images/')[1])
      .filter(Boolean)
    if (paths.length > 0) await must(db.storage.from('artist-images').remove(paths), 'headshots')
    await must(db.from('artists').delete().in('auth_user_id', ids), 'komikerrader')
  }
  await must(db.from('artists').delete().like('email', `${EMAIL_PREFIX}%@example.com`), 'komikerrader på e-post')

  const clubs = await must(db.from('clubs').select('id').in('slug', CLUBS.map((spec) => spec.slug)), 'klubber')
  if (clubs.length > 0) await must(db.from('clubs').delete().in('id', clubs.map((club) => club.id)), 'klubber')

  for (const user of testUsers) await must(db.auth.admin.deleteUser(user.id), `bruker ${user.email}`)

  if (existsSync(CREDENTIALS_FILE)) rmSync(CREDENTIALS_FILE)
  console.log(`Slettet ${testUsers.length} testinnlogging(er) og ${clubs.length} klubb(er).`)
}

loadEnv()
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const command = process.argv[2]
if (command === 'create') await create(db)
else if (command === 'delete') await remove(db)
else {
  console.error('Bruk: node scripts/invite-link-test-data.mjs create|delete')
  process.exit(1)
}
