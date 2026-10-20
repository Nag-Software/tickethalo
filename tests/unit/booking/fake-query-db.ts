/**
 * En liten stand-in for supabase-klienten til tester som gjør mange
 * spørringer mot samme tabell.
 *
 * Hver tabell svarer gjennom en funksjon som ser filtrene spørringen fikk
 * (`eq`, `in`, `is`, …), om den ba om en telling (`head`), og om den skrev
 * (`insert`/`update`). Da kan «plassen er full» og «komikeren har ingen
 * plass» svares fra samme tabell i samme test.
 */

export type FakeQuery = {
  table: string
  filters: Record<string, unknown>
  head: boolean
  write: 'insert' | 'update' | null
  values: unknown
}

export type FakeResult = { data?: unknown; error?: unknown; count?: number | null }

export type FakeTables = Record<string, (query: FakeQuery) => FakeResult>

export function fakeQueryDb(tables: FakeTables) {
  const queries: FakeQuery[] = []

  const db = {
    from: (table: string) => {
      const state: FakeQuery = { table, filters: {}, head: false, write: null, values: null }
      queries.push(state)

      const resolve = () => ({ data: null, error: null, count: null, ...(tables[table]?.(state) ?? {}) })
      const filter = (op: string) => (column: string, value?: unknown) => {
        state.filters[op === 'eq' ? column : `${column}:${op}`] = value
        return query
      }

      const query: Record<string, unknown> = {
        select: (_columns?: string, options?: { head?: boolean }) => {
          if (options?.head) state.head = true
          return query
        },
        insert: (values: unknown) => {
          state.write = 'insert'
          state.values = values
          return query
        },
        update: (values: unknown) => {
          state.write = 'update'
          state.values = values
          return query
        },
        eq: filter('eq'),
        neq: filter('neq'),
        in: filter('in'),
        is: filter('is'),
        gte: filter('gte'),
        or: (value: string) => {
          state.filters.or = value
          return query
        },
        order: () => query,
        limit: () => query,
        single: () => Promise.resolve(resolve()),
        maybeSingle: () => Promise.resolve(resolve()),
        then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve(resolve()).then(onFulfilled, onRejected),
      }
      return query
    },
  }

  return { db: db as never, queries }
}
