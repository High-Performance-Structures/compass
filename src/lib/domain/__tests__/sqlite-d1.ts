import Database from "better-sqlite3"

import { getDb } from "@/db"
import type { Db } from "@/lib/server/action-context"

type Sqlite = InstanceType<typeof Database>

/** A minimal D1 binding over an in-memory SQLite database, for store and action tests. */
export function d1Over(sqlite: Sqlite): unknown {
  function statementFor(statement: ReturnType<Sqlite["prepare"]>, values: readonly unknown[] = []): Record<string, unknown> {
    // better-sqlite3 marks statements that return rows (SELECT, RETURNING).
    const reader = Boolean(Reflect.get(statement, "reader"))
    return {
      bind: (...next: unknown[]): unknown => statementFor(statement, next),
      run: async (): Promise<unknown> => {
        if (reader) return { success: true, results: statement.all(...values), meta: { changes: 0 } }
        const info = statement.run(...values)
        return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }
      },
      all: async (): Promise<unknown> => ({ success: true, results: reader ? statement.all(...values) : [] }),
      raw: async (): Promise<unknown> => (reader ? statement.raw().all(...values) : []),
      first: async (): Promise<unknown> => (reader ? statement.all(...values)[0] ?? null : null),
    }
  }
  return {
    prepare: (query: string): unknown => statementFor(sqlite.prepare(query)),
    // D1 runs a batch as one transaction: in order, all or nothing.
    batch: async (statements: readonly { run: () => Promise<unknown> }[]): Promise<unknown[]> => {
      sqlite.exec("BEGIN")
      try {
        const results: unknown[] = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec("COMMIT")
        return results
      } catch (error) {
        sqlite.exec("ROLLBACK")
        throw error
      }
    },
    exec: async (query: string): Promise<unknown> => {
      sqlite.exec(query)
      return { count: 0, duration: 0 }
    },
  }
}

/** A fresh in-memory database with `schema` applied, plus a drizzle handle. */
export function sqliteDb(schema: string): { readonly sqlite: Sqlite; readonly db: Db } {
  const sqlite = new Database(":memory:")
  sqlite.exec(schema)
  // @ts-expect-error The test binding implements only what drizzle's D1 driver calls.
  return { sqlite, db: getDb(d1Over(sqlite)) }
}
