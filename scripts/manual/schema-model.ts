// Builds a plain model of the database from the Drizzle schema files, for the
// Developer Manual's data dictionary (Appendix A) and ER diagrams (chapter 5).
//
// Structure (columns, types, defaults, foreign keys, indexes) comes from
// Drizzle's own table config; table and column descriptions come from the
// comments next to each definition; the owning writer files come from
// scripts/architecture-metrics.mjs (the same measure the CI ratchet uses).
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core"

import { computeArchitectureMetrics } from "../architecture-metrics.mjs"

export type ColumnModel = {
  readonly name: string
  readonly property: string
  readonly type: string
  readonly nullable: boolean
  readonly primaryKey: boolean
  readonly unique: boolean
  readonly defaultValue: string | null
  readonly references: string | null
  readonly onDelete: string | null
  readonly enumValues: readonly string[] | null
  readonly comment: string | null
}

export type IndexModel = {
  readonly name: string
  readonly unique: boolean
  readonly columns: readonly string[]
  readonly where: boolean
}

export type TableModel = {
  readonly name: string
  readonly exportName: string
  readonly schemaFile: string
  readonly purpose: string | null
  readonly columns: readonly ColumnModel[]
  readonly indexes: readonly IndexModel[]
  readonly compositePrimaryKey: readonly string[] | null
  readonly checks: number
  readonly writers: readonly string[]
  readonly domain: string
}

/** Schema files in the order drizzle.config.ts lists them. */
export function schemaFiles(root: string): string[] {
  const text = readFileSync(join(root, "drizzle.config.ts"), "utf8")
  return [...text.matchAll(/"\.\/(src\/[^"]+\.ts)"/g)].map((match) => match[1])
}

function commentBlockAbove(lines: readonly string[], index: number): string | null {
  const collected: string[] = []
  let cursor = index - 1
  while (cursor >= 0) {
    const line = lines[cursor].trim()
    if (line.startsWith("//")) {
      collected.unshift(line.replace(/^\/\/\s?/, ""))
    } else if (line.startsWith("*") || line.startsWith("/**") || line.endsWith("*/")) {
      const cleaned = line.replace(/^\/\*\*?\s?/, "").replace(/\*\/$/, "").replace(/^\*\s?/, "").trim()
      if (cleaned) collected.unshift(cleaned)
    } else {
      break
    }
    cursor -= 1
  }
  const text = collected
    .filter((line) => !/^(fk-exempt|json|snapshot):/i.test(line) || collected.length === 1)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
  return text || null
}

type SourceComments = {
  readonly purpose: string | null
  readonly columns: ReadonlyMap<string, string>
}

/** Comments around a table definition and its column lines. */
function sourceComments(text: string, sqlName: string): SourceComments {
  const lines = text.split("\n")
  const quoted = new RegExp(`^\\s*(?:.*sqliteTable\\(\\s*)?["'\`]${sqlName}["'\`]`)
  const start = lines.findIndex(
    (line, index) =>
      (line.includes("sqliteTable(") && quoted.test(line)) ||
      (index > 0 && /sqliteTable\(\s*$/.test(lines[index - 1]) && quoted.test(line)),
  )
  if (start < 0) return { purpose: null, columns: new Map() }
  // The comment sits above the `export const` line, which may be the same line.
  let exportLine = start
  while (exportLine > 0 && !/export\s+const/.test(lines[exportLine])) exportLine -= 1
  const purpose = commentBlockAbove(lines, exportLine)
  const columns = new Map<string, string>()
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^export\s+/.test(line)) break
    const match = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*(?:text|integer|real|blob|numeric)\(\s*["'`]([a-z0-9_]+)["'`]/.exec(line)
    if (!match) continue
    const trailing = /\/\/\s?(.*)$/.exec(line)?.[1]?.trim()
    const above = commentBlockAbove(lines, index)
    const comment = trailing || above
    if (comment) columns.set(match[1], comment)
  }
  return { purpose, columns }
}

function defaultText(column: { hasDefault: boolean; default: unknown; defaultFn?: unknown }): string | null {
  if (!column.hasDefault) return null
  const value = column.default
  if (value === undefined) return column.defaultFn ? "(computed in app)" : null
  if (typeof value === "object" && value !== null) {
    const chunks = Reflect.get(value, "queryChunks")
    if (Array.isArray(chunks)) {
      const sql = chunks
        .map((chunk) => {
          if (typeof chunk === "string") return chunk
          const parts = typeof chunk === "object" && chunk !== null ? Reflect.get(chunk, "value") : null
          return Array.isArray(parts) ? parts.join("") : ""
        })
        .join("")
      return sql ? `sql: ${sql}` : "sql expression"
    }
    return JSON.stringify(value)
  }
  return String(value)
}

/** The domain module that owns a table, from where its writers live. */
function owningDomain(writers: readonly string[], schemaFile: string): string {
  const counts = new Map<string, number>()
  for (const writer of writers) {
    const match = /^src\/lib\/domain\/([^/]+)\//.exec(writer)
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  if (best) return best[0]
  const base = /schema-?([a-z-]*)\.ts$/.exec(schemaFile)?.[1]
  return base ? `schema:${base}` : "schema:core"
}

export async function buildSchemaModel(root: string): Promise<TableModel[]> {
  const metrics = computeArchitectureMetrics(root)
  const writerMap: Record<string, string[]> = metrics.tableWriters
  const tables: TableModel[] = []
  const seen = new Set<string>()
  for (const file of schemaFiles(root)) {
    const source = readFileSync(join(root, file), "utf8")
    const schemaModule: Record<string, unknown> = await import(join(root, file))
    for (const [exportName, value] of Object.entries(schemaModule)) {
      if (!(value instanceof SQLiteTable)) continue
      const config = getTableConfig(value)
      if (seen.has(config.name)) continue
      seen.add(config.name)
      const comments = sourceComments(source, config.name)
      const fkByColumn = new Map<string, { target: string; onDelete: string | null }>()
      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference()
        const target = getTableConfig(reference.foreignTable).name
        reference.columns.forEach((column, index) => {
          fkByColumn.set(column.name, {
            target: `${target}.${reference.foreignColumns[index]?.name ?? "id"}`,
            onDelete: foreignKey.onDelete ?? null,
          })
        })
      }
      const columns: ColumnModel[] = config.columns.map((column) => {
        const fk = fkByColumn.get(column.name)
        const enumValues = Array.isArray(column.enumValues) && column.enumValues.length > 0 ? column.enumValues : null
        return {
          name: column.name,
          property: Object.entries(value).find(([, candidate]) => candidate === column)?.[0] ?? column.name,
          type: column.getSQLType(),
          nullable: !column.notNull,
          primaryKey: column.primary,
          unique: column.isUnique,
          defaultValue: defaultText(column),
          references: fk?.target ?? null,
          onDelete: fk?.onDelete ?? null,
          enumValues,
          comment: comments.columns.get(column.name) ?? null,
        }
      })
      const indexes: IndexModel[] = config.indexes.map((index) => ({
        name: index.config.name,
        unique: Boolean(index.config.unique),
        columns: index.config.columns.map((column) =>
          typeof column === "object" && column !== null && "name" in column && typeof column.name === "string"
            ? column.name
            : "(expression)",
        ),
        where: Boolean(index.config.where),
      }))
      const compositePrimaryKey = config.primaryKeys[0]?.columns.map((column) => column.name) ?? null
      const writers = writerMap[exportName] ?? []
      tables.push({
        name: config.name,
        exportName,
        schemaFile: file,
        purpose: comments.purpose,
        columns,
        indexes,
        compositePrimaryKey,
        checks: config.checks.length,
        writers,
        domain: owningDomain(writers, file),
      })
    }
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name))
}
