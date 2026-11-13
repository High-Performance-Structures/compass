/**
 * An INSERT of one row that lands only when `condition` holds at write time,
 * as a statement for `db.batch` (INSERT … SELECT <values> WHERE <condition>).
 * For follow-up rows (history, lines) that must land only with the write a
 * batch guards. Every column gets the row's value, else its static default,
 * else NULL, in table order (Drizzle inserts a select's columns that way).
 * The owning domain store wraps it for its own table.
 */
import { getTableColumns, sql, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core"

import type { Db } from "@/lib/server/action-context"

export function insertWhenStatement<T extends SQLiteTable>(
  db: Db,
  table: T,
  row: T["$inferInsert"],
  condition: SQL,
): BatchItem<"sqlite"> {
  const columns: Record<string, SQLiteColumn> = getTableColumns(table)
  const values = Object.entries(columns).map(([key, column]) => {
    const given: unknown = Reflect.get(row, key)
    const value = given !== undefined ? given : column.default !== undefined && !(column.default instanceof Object) ? column.default : null
    return sql`${typeof value === "boolean" ? Number(value) : value}`
  })
  return db.insert(table).select(sql`SELECT ${sql.join(values, sql`, `)} WHERE ${condition}`)
}
