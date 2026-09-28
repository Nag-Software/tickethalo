// Minimal migration runner for supabase/migrations/*.sql
//
// Usage:
//   pnpm db:migrate:status                  — list applied vs pending
//   pnpm db:migrate:verify                  — check that every table, column,
//                                             view and function the migrations
//                                             create actually exists in the DB
//                                             (add --dry-run to only print the
//                                             expectation, without a DB)
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

// ─────────────────────────────────────────────────────────────
// verify: what the migrations say should exist
//
// The production database was set up by hand before this runner existed,
// and a table from 001 turned out to be missing. This walks every migration
// in order and collects the tables, columns, views and functions they
// create (and forgets the ones they drop), then compares with the database.
// The parser is deliberately simple; it reads the shapes these files use.
// ─────────────────────────────────────────────────────────────

const COLUMN_TYPES =
  '(?:uuid|text|varchar|char|int|integer|bigint|smallint|serial|bigserial|numeric|decimal|real|double|boolean|bool|timestamptz|timestamp|date|time|jsonb|json|bytea|interval)'

function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, '')
}

function expectedSchema() {
  const tables = new Map() // name -> Set(columns)
  const views = new Set()
  const functions = new Set()

  for (const file of migrationFiles()) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    // Split on semicolons that end a statement. Function bodies use $$ … $$,
    // which contain semicolons, so cut those out first.
    const statements = sql.replace(/\$\$[\s\S]*?\$\$/g, ' $$body$$ ').split(';')

    for (const raw of statements) {
      const st = raw.trim()
      if (!st) continue
      const lower = st.toLowerCase()

      let m
      if ((m = /^create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/i.exec(st))) {
        const name = m[1].toLowerCase()
        const columns = tables.get(name) ?? new Set()
        const body = st.slice(st.indexOf('(') + 1)
        for (const line of body.split('\n')) {
          const col = new RegExp(`^\\s*(\\w+)\\s+${COLUMN_TYPES}\\b`, 'i').exec(line)
          if (col && !/^(constraint|primary|unique|check|foreign|references)$/i.test(col[1])) {
            columns.add(col[1].toLowerCase())
          }
        }
        tables.set(name, columns)
      } else if ((m = /^drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)/i.exec(st))) {
        tables.delete(m[1].toLowerCase())
      } else if ((m = /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?(\w+)/i.exec(st))) {
        const name = m[1].toLowerCase()
        const columns = tables.get(name) ?? new Set()
        for (const add of st.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)) columns.add(add[1].toLowerCase())
        for (const drop of st.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?(\w+)/gi)) columns.delete(drop[1].toLowerCase())
        for (const ren of st.matchAll(/rename\s+column\s+(\w+)\s+to\s+(\w+)/gi)) {
          columns.delete(ren[1].toLowerCase())
          columns.add(ren[2].toLowerCase())
        }
        if (/rename\s+to\s+(\w+)/i.test(st) && !/rename\s+column/i.test(st)) {
          const target = /rename\s+to\s+(\w+)/i.exec(st)[1].toLowerCase()
          tables.delete(name)
          tables.set(target, columns)
        } else if (tables.has(name) || columns.size > 0) {
          tables.set(name, columns)
        }
      } else if ((m = /^create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?(\w+)/i.exec(st))) {
        views.add(m[1].toLowerCase())
      } else if ((m = /^drop\s+view\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)/i.exec(st))) {
        views.delete(m[1].toLowerCase())
      } else if ((m = /^create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)/i.exec(st))) {
        functions.add(m[1].toLowerCase())
      } else if ((m = /^drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)/i.exec(st))) {
        // Dropped and re-created in the same file is the common pattern; the
        // create that follows adds it back.
        functions.delete(m[1].toLowerCase())
      }
      void lower
    }
  }

  return { tables, views, functions }
}

async function verify(client) {
  const expected = expectedSchema()

  const [tableRows, columnRows, viewRows, functionRows] = await Promise.all([
    client.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'"),
    client.query("select table_name, column_name from information_schema.columns where table_schema = 'public'"),
    client.query("select table_name from information_schema.views where table_schema = 'public'"),
    client.query(
      "select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'",
    ),
  ])

  const haveTables = new Set(tableRows.rows.map((r) => r.table_name))
  const haveColumns = new Set(columnRows.rows.map((r) => `${r.table_name}.${r.column_name}`))
  const haveViews = new Set(viewRows.rows.map((r) => r.table_name))
  const haveFunctions = new Map(functionRows.rows.map((r) => [r.proname, r.proconfig ?? []]))

  const missing = []
  for (const [table, columns] of expected.tables) {
    if (!haveTables.has(table)) {
      missing.push(`table ${table}`)
      continue
    }
    for (const column of columns) {
      if (!haveColumns.has(`${table}.${column}`)) missing.push(`column ${table}.${column}`)
    }
  }
  for (const view of expected.views) if (!haveViews.has(view)) missing.push(`view ${view}`)
  for (const fn of expected.functions) if (!haveFunctions.has(fn)) missing.push(`function ${fn}`)

  // Migration 064: without `extensions` on the search path, every paid
  // checkout fails to create a ticket.
  const ticketCodeConfig = haveFunctions.get('generate_ticket_code') ?? []
  const searchPath = ticketCodeConfig.find((entry) => entry.startsWith('search_path='))
  if (haveFunctions.has('generate_ticket_code') && !(searchPath ?? '').includes('extensions')) {
    missing.push(`generate_ticket_code search_path is "${searchPath ?? 'unset'}" — migration 064 expects "public, extensions"`)
  }

  const columnCount = [...expected.tables.values()].reduce((n, cols) => n + cols.size, 0)
  console.log(
    `Checked ${expected.tables.size} tables, ${columnCount} columns, ${expected.views.size} views, ${expected.functions.size} functions.`,
  )
  if (missing.length === 0) {
    console.log('✓ Everything the migrations create exists in the database.')
    return true
  }
  console.log(`\n✗ ${missing.length} missing:`)
  for (const item of missing) console.log('  - ' + item)
  return false
}

async function main() {
  loadEnvLocal()
  const command = process.argv[2] ?? 'up'
  const files = migrationFiles()

  if (command === 'verify' && process.argv.includes('--dry-run')) {
    const expected = expectedSchema()
    for (const [table, columns] of expected.tables) console.log(`table ${table}: ${[...columns].join(', ')}`)
    for (const view of expected.views) console.log(`view ${view}`)
    for (const fn of expected.functions) console.log(`function ${fn}`)
    return
  }

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

    if (command === 'verify') {
      const ok = await verify(client)
      if (!ok) process.exit(1)
      return
    }

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
      console.error(`Unknown command: ${command} (expected: up | status | verify | baseline)`)
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
