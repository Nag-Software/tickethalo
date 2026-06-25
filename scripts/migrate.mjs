// Minimal migration runner for supabase/migrations/*.sql
//
// Usage:
//   pnpm db:migrate:status                  — list applied vs pending
//   pnpm db:migrate:baseline -- --through 033
//                                           — mark migrations 001..033 as applied
//                                             WITHOUT running them (one-time, for a DB
//                                             that was already migrated by hand)
//   pnpm db:migrate                         — apply all pending migrations, in order,
//                                             each in its own transaction
//
// Requires DATABASE_URL in .env.local (Supabase → Project Settings → Database →
// Connection string → URI). Use the direct connection or the SESSION pooler — the
// transaction pooler (port 6543) does not support multi-statement transactions.
//
// Note: each migration runs inside BEGIN/COMMIT, so a migration that needs to run
// outside a transaction (e.g. CREATE INDEX CONCURRENTLY) is not supported here.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

// Lazily load .env.local without overriding already-set process env.
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
    const [, key] = match
    let value = match[2]
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{3}.*\.sql$/.test(name))
    .sort()
}

function flag(name) {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : null
}

async function main() {
  loadEnvLocal()
  const command = process.argv[2] ?? 'up'
  const files = migrationFiles()

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('✗ DATABASE_URL is not set.')
    console.error('  Add it to .env.local — Supabase → Project Settings → Database →')
    console.error('  Connection string → URI (direct connection or Session pooler).')
    process.exit(1)
  }

  let pg
  try {
    pg = (await import('pg')).default
  } catch {
    console.error('✗ The "pg" package is not installed. Run: pnpm install')
    process.exit(1)
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    await client.query(
      `create table if not exists schema_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    )
    const appliedRows = await client.query('select name from schema_migrations')
    const applied = new Set(appliedRows.rows.map((row) => row.name))

    if (command === 'status') {
      for (const file of files) {
        console.log(`${applied.has(file) ? '✓ applied' : '· pending'}  ${file}`)
      }
      const pendingCount = files.filter((f) => !applied.has(f)).length
      console.log(`\n${applied.size} applied, ${pendingCount} pending.`)
      return
    }

    if (command === 'baseline') {
      const through = flag('--through')
      if (!through) {
        console.error('Usage: pnpm db:migrate:baseline -- --through <NNN>')
        console.error('Marks every migration with a numeric prefix <= NNN as applied')
        console.error('WITHOUT running it — use this once on a DB already migrated by hand.')
        console.error('\nMigration files:')
        for (const file of files) console.error('  ' + file)
        process.exit(1)
      }
      const cutoff = String(through).padStart(3, '0')
      const toMark = files.filter((file) => file.slice(0, 3) <= cutoff && !applied.has(file))
      for (const file of toMark) {
        await client.query('insert into schema_migrations(name) values ($1) on conflict do nothing', [file])
        console.log(`baselined (not run): ${file}`)
      }
      console.log(`\nBaselined ${toMark.length} migration(s) through ${cutoff}.`)
      return
    }

    if (command !== 'up') {
      console.error(`Unknown command: ${command} (expected: up | status | baseline)`)
      process.exit(1)
    }

    const pending = files.filter((file) => !applied.has(file))
    if (pending.length === 0) {
      console.log('No pending migrations.')
      return
    }

    for (const file of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      process.stdout.write(`applying ${file} ... `)
      try {
        await client.query('begin')
        await client.query(sql)
        await client.query('insert into schema_migrations(name) values ($1)', [file])
        await client.query('commit')
        console.log('ok')
      } catch (error) {
        await client.query('rollback').catch(() => {})
        console.log('FAILED')
        console.error(error?.message ?? error)
        console.error(`\nStopped. "${file}" was rolled back; earlier migrations stay applied.`)
        process.exit(1)
      }
    }
    console.log(`\nApplied ${pending.length} migration(s).`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
