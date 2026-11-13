/**
 * An INSERT … SELECT that copies one table's rows into the same table, as a
 * statement for `db.batch` (a raw `db.run(sql)` can't join a D1 batch with
 * parameters). Every column is copied from the source row unless `set`
 * gives it a value; the copy lands only for rows matching `where`, so a
 * batch can make it conditional on state it checks at write time. Used by
 * the selections stores for replacements.
 */
import { getTableColumns, sql, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core"

import type { Db } from "@/lib/server/action-context"

export function insertCopyStatement<T extends SQLiteTable>(
  db: Db,
  table: T,
  set: Readonly<Partial<Record<keyof T["_"]["columns"], string | number | boolean | null>>>,
  where: SQL | undefined,
): BatchItem<"sqlite"> {
  const columns: Record<string, SQLiteColumn> = getTableColumns(table)
  // Same keys in the same order as the table: Drizzle inserts the select's columns in table order.
  const fields = Object.fromEntries(
    Object.entries(columns).map(([key, column]) => {
      if (!Object.prototype.hasOwnProperty.call(set, key)) return [key, column]
      const value: unknown = Reflect.get(set, key)
      const bound = typeof value === "boolean" ? Number(value) : value
      return [key, sql`${bound}`.as(column.name)]
    }),
  )
  return db.insert(table).select(db.select(fields).from(table).where(where))
}
