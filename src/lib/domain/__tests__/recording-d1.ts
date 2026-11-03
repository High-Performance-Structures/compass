import Database from "better-sqlite3"

import { isRecord } from "@/lib/shared/guards"

/** What a raw D1 statement would send: its SQL text and bind values. */
export type RecordedStatement = { readonly sql: string; readonly binds: readonly unknown[] }

/**
 * A D1 binding that only records `prepare(sql).bind(...values)`, so a test
 * can compare the statement a store builds with the one a caller used to.
 */
export function recordingD1(): D1Database {
  const fake = {
    prepare: (sql: string) => ({ bind: (...binds: unknown[]): RecordedStatement => ({ sql, binds }) }),
  }
  // @ts-expect-error The test double implements only prepare().bind().
  return fake
}

/** Reads back what `recordingD1` captured for one statement. */
export function recorded(statement: unknown): RecordedStatement {
  if (!isRecord(statement) || typeof statement.sql !== "string" || !Array.isArray(statement.binds)) {
    throw new Error("Not a recorded statement")
  }
  return { sql: statement.sql, binds: statement.binds }
}

/**
 * SQL text with insignificant whitespace removed, so a statement moved into
 * a store (and re-indented) compares equal to the original.
 */
export function normalizedSql(sql: string): string {
  return sql.replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").trim()
}

/** Normalized SQL plus binds, for `toEqual` comparisons. */
export function statementShape(statement: unknown): RecordedStatement {
  const { sql, binds } = recorded(statement)
  return { sql: normalizedSql(sql), binds }
}

/** The old statement written out in a test, in the same shape. */
export function expectedShape(sql: string, binds: readonly unknown[]): RecordedStatement {
  return { sql: normalizedSql(sql), binds }
}

type Sqlite = InstanceType<typeof Database>

/** Runs each recorded statement on `sqlite` in order (an executed equivalence check). */
export function runRecorded(sqlite: Sqlite, statements: readonly unknown[]): void {
  for (const statement of statements) {
    const { sql, binds } = recorded(statement)
    sqlite.prepare(sql).run(...binds)
  }
}

/** Every row of `table`, ordered for comparison. */
export function rowsOf(sqlite: Sqlite, table: string): unknown[] {
  return sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()
}

/** A fresh in-memory SQLite database with `schema` applied. */
export function sqliteWith(schema: string): Sqlite {
  const sqlite = new Database(":memory:")
  sqlite.exec(schema)
  return sqlite
}
