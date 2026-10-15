/** Test helper: an in-memory SQLite database with the real schema, behind a D1 stand-in. */
import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

import { getDb } from "@/db"

type Statement = {
  readonly run: (...values: readonly unknown[]) => { readonly changes: number | bigint }
  readonly all: (...values: readonly unknown[]) => readonly Record<string, unknown>[]
  readonly get: (...values: readonly unknown[]) => unknown
}
export type Sqlite = { readonly exec: (sql: string) => void; readonly prepare: (sql: string) => Statement }

const nodeRequire = createRequire(import.meta.url)

export function newSqlite(): Sqlite {
  const imported: unknown = nodeRequire("node:sqlite")
  const Database = imported !== null && typeof imported === "object" ? Reflect.get(imported, "DatabaseSync") : undefined
  if (typeof Database !== "function") throw new Error("node:sqlite is unavailable")
  const instance: unknown = Reflect.construct(Database, [":memory:"])
  if (instance === null || typeof instance !== "object") throw new Error("Unable to open SQLite")
  return {
    exec: (sql) => Reflect.apply(Reflect.get(instance, "exec"), instance, [sql]),
    prepare: (sql) => Reflect.apply(Reflect.get(instance, "prepare"), instance, [sql]),
  }
}

/** Just enough of D1 for drizzle: prepare/bind and run, all, first, raw. */
type D1 = Parameters<typeof getDb>[0]

// Tests hand drizzle a small stand-in that has D1's prepare and batch.
function isD1(value: unknown): value is D1 {
  return typeof value === "object" && value !== null && "prepare" in value && "batch" in value
}

export function d1(sqlite: Sqlite): D1 {
  function prepared(query: string, values: readonly unknown[] = []): Record<string, unknown> {
    const statement = sqlite.prepare(query)
    const bound = values.map((value) => (typeof value === "boolean" ? Number(value) : value))
    return {
      bind: (...next: readonly unknown[]) => prepared(query, next),
      run: async () => ({ success: true, meta: { changes: Number(statement.run(...bound).changes) } }),
      all: async () => ({ success: true, results: statement.all(...bound) }),
      first: async () => statement.get(...bound) ?? null,
      // Arrays keep columns that share a name (a join's two display_name columns), as D1 does.
      raw: async () => {
        const arrays = sqlite.prepare(query)
        Reflect.apply(Reflect.get(arrays, "setReturnArrays"), arrays, [true])
        return arrays.all(...bound)
      },
    }
  }
  const database = {
    prepare: (query: string) => prepared(query),
    batch: async (statements: readonly { readonly run: () => Promise<unknown> }[]) => Promise.all(statements.map((statement) => statement.run())),
  }
  if (!isD1(database)) throw new Error("Not a D1 stand-in")
  return database
}

export function migrate(sqlite: Sqlite): void {
  const dir = join(process.cwd(), "drizzle")
  for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
}


/** A fresh in-memory database with every migration applied. */
export function migratedSqlite(): Sqlite {
  const sqlite = newSqlite()
  migrate(sqlite)
  return sqlite
}
