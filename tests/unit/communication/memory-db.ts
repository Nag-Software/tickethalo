/**
 * En Supabase i minnet til testene av lineup-meldingene: tabeller som
 * lister, og akkurat de filtrene lib/lineup-messages.ts bruker.
 */

type Row = Record<string, unknown>

let counter = 0

export function memoryDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
    let values: Row | Row[] | undefined
    let upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } = {}
    let single = false
    let head = false
    let count = false
    const filters: Array<(row: Row) => boolean> = []
    const rows = () => (tables[table] ??= [])
    const value = (row: Row, column: string) => row[column] ?? null

    const run = () => {
      const match = (row: Row) => filters.every((filter) => filter(row))
      if (op === 'insert') {
        const list = (Array.isArray(values) ? values : [values!]).map((row) => ({
          id: `${table}-${++counter}`,
          created_at: new Date().toISOString(),
          ...row,
        }))
        rows().push(...list)
        return { data: single ? list[0] : list, error: null }
      }
      if (op === 'upsert') {
        // Samme regel som PostgREST: en rad som kolliderer på `onConflict`
        // oppdateres, eller hoppes over med `ignoreDuplicates` og kommer da
        // ikke tilbake.
        const keys = (upsertOptions.onConflict ?? 'id').split(',')
        const touched: Row[] = []
        for (const row of Array.isArray(values) ? values : [values!]) {
          const existing = rows().find((other) => keys.every((key) => other[key] === row[key]))
          if (existing) {
            if (upsertOptions.ignoreDuplicates) continue
            Object.assign(existing, row)
            touched.push(existing)
          } else {
            const inserted = { id: `${table}-${++counter}`, created_at: new Date().toISOString(), ...row }
            rows().push(inserted)
            touched.push(inserted)
          }
        }
        return { data: single ? touched[0] ?? null : touched, error: null }
      }
      if (op === 'update') {
        const hit = rows().filter(match)
        hit.forEach((row) => Object.assign(row, values))
        return { data: hit, error: null }
      }
      if (op === 'delete') {
        tables[table] = rows().filter((row) => !match(row))
        return { data: null, error: null }
      }
      const hit = rows().filter(match)
      if (head) return { count: hit.length, data: null, error: null }
      return { data: single ? hit[0] ?? null : hit, error: null, ...(count ? { count: hit.length } : {}) }
    }

    const chain: Record<string, unknown> = {
      select: (_columns?: string, options?: { head?: boolean; count?: string }) => {
        if (options?.head) head = true
        if (options?.count) count = true
        return chain
      },
      upsert: (next: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
        op = 'upsert'
        values = next
        upsertOptions = options
        return chain
      },
      insert: (next: Row | Row[]) => {
        op = 'insert'
        values = next
        return chain
      },
      update: (next: Row) => {
        op = 'update'
        values = next
        return chain
      },
      delete: () => {
        op = 'delete'
        return chain
      },
      eq: (column: string, expected: unknown) => {
        filters.push((row) => value(row, column) === expected)
        return chain
      },
      in: (column: string, list: unknown[]) => {
        filters.push((row) => list.includes(value(row, column)))
        return chain
      },
      is: (column: string, expected: unknown) => {
        filters.push((row) => value(row, column) === expected)
        return chain
      },
      gt: (column: string, bound: string) => {
        filters.push((row) => String(value(row, column)) > bound)
        return chain
      },
      lte: (column: string, bound: string) => {
        filters.push((row) => String(value(row, column)) <= bound)
        return chain
      },
      not: (column: string, operator: string, list: string | null) => {
        if (operator === 'is') {
          filters.push((row) => value(row, column) !== list)
          return chain
        }
        const excluded = (list ?? '').replace(/[()]/g, '').split(',')
        filters.push((row) => !excluded.includes(String(value(row, column))))
        return chain
      },
      order: () => chain,
      limit: () => chain,
      range: () => chain,
      single: () => {
        single = true
        return chain
      },
      maybeSingle: () => {
        single = true
        return chain
      },
      then: (resolve: (result: unknown) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
    }
    return chain
  }

  return { from }
}
