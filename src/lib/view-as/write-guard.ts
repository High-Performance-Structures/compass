/*
 * The central View as write guard. While a request carries a View as cookie,
 * getCloudflareContext() (src/lib/db.ts) hands out these wrappers instead of
 * the real bindings, so every database write fails closed: Drizzle through
 * getDb(env.DB), raw env.DB statements and batches, server actions and API
 * routes alike. Reads pass straight through to the real binding.
 *
 * A statement is allowed only when it is plainly a read (SELECT, a WITH that
 * writes nothing, EXPLAIN, VALUES, or a PRAGMA query without "="); anything
 * else, including SQL the guard cannot classify, is blocked.
 *
 * Two ways to block (GuardMode), both of which leave the data untouched:
 * - "reject" (server actions): the write throws ViewAsReadOnlyError, so the
 *   action reports "View as is read only" instead of a false success.
 * - "skip" (page renders and GET routes): the write is dropped and answers
 *   as if nothing matched, so a screen that stamps a cache or a "seen" flag
 *   while rendering still shows exactly what the person would see.
 */
import { VIEW_AS_READ_ONLY_MESSAGE } from "@/lib/view-as/constants"
import { isRecord } from "@/lib/shared/guards"

export class ViewAsReadOnlyError extends Error {
  constructor(detail?: string) {
    super(detail ? `${VIEW_AS_READ_ONLY_MESSAGE} (${detail})` : VIEW_AS_READ_ONLY_MESSAGE)
    this.name = "ViewAsReadOnlyError"
  }
}

/** Leading whitespace, comments and opening parentheses removed. */
function sqlBody(sql: string): string {
  let rest = sql
  for (;;) {
    const trimmed = rest.replace(/^[\s(]+/, "")
    if (trimmed.startsWith("--")) {
      const end = trimmed.indexOf("\n")
      rest = end === -1 ? "" : trimmed.slice(end + 1)
    } else if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/")
      rest = end === -1 ? "" : trimmed.slice(end + 2)
    } else {
      return trimmed
    }
  }
}

const WRITE_KEYWORD = /\b(insert|update|delete|replace|upsert|create|drop|alter|attach|detach|vacuum|reindex)\b/i

/**
 * PRAGMAs that only report. Anything else (setters, the function form such
 * as `foreign_keys(OFF)`, or maintenance like `optimize`) is refused.
 */
const READ_ONLY_PRAGMAS = new Set([
  "table_info",
  "table_xinfo",
  "table_list",
  "index_list",
  "index_info",
  "index_xinfo",
  "foreign_key_list",
  "foreign_key_check",
  "database_list",
  "compile_options",
  "user_version",
  "schema_version",
])
const SCHEMA_PRAGMAS = new Set(["table_info", "table_xinfo", "index_list", "index_info", "index_xinfo", "foreign_key_list", "foreign_key_check"])

function isReadOnlyPragma(body: string): boolean {
  const match = /^pragma\s+(?:"?main"?\.)?([a-z_]+)\s*(?:\(\s*(["'`]?)([A-Za-z0-9_]+)\2\s*\))?\s*;?\s*$/i.exec(body)
  if (!match) return false
  const name = (match[1] ?? "").toLowerCase()
  if (!READ_ONLY_PRAGMAS.has(name)) return false
  // Only the schema-reading PRAGMAs take an argument (a table or index name).
  return match[3] === undefined || SCHEMA_PRAGMAS.has(name)
}

/** True only for SQL that cannot change data. Unknown or multi-statement SQL is not read-only. */
export function isReadOnlySql(sql: string): boolean {
  const body = sqlBody(sql)
  // A second statement after a semicolon could be anything.
  if (/;\s*\S/.test(body)) return false
  const keyword = /^[a-z]+/i.exec(body)?.[0]?.toLowerCase()
  switch (keyword) {
    case "select":
    case "values":
    case "explain":
      return true
    case "with":
      return !WRITE_KEYWORD.test(body)
    case "pragma":
      return isReadOnlyPragma(body)
    default:
      return false
  }
}

export type GuardMode = "reject" | "skip"

type StatementInfo = { readonly real: D1PreparedStatement; readonly sql: string }

// Wrapped statement -> the real one, so batches can be checked and unwrapped.
const statements = new WeakMap<object, StatementInfo>()

function rejected(detail: string): Promise<never> {
  return Promise.reject(new ViewAsReadOnlyError(detail))
}

const EMPTY_META = { changes: 0, last_row_id: 0, duration: 0, rows_read: 0, rows_written: 0, changed_db: false, size_after: 0 }

/** What a dropped statement answers: nothing matched, nothing changed. */
function emptyResult(method: "run" | "all" | "first" | "raw"): unknown {
  if (method === "first") return null
  if (method === "raw") return []
  return { success: true, results: [], meta: EMPTY_META }
}

function blockedStatement(mode: GuardMode, method: "run" | "all" | "first" | "raw"): () => Promise<unknown> {
  return mode === "reject" ? () => rejected("database write") : async () => emptyResult(method)
}

/** Methods on the real binding must run with the real object as `this`. */
function passThrough(target: object, property: string | symbol): unknown {
  const value: unknown = Reflect.get(target, property, target)
  return typeof value === "function" ? value.bind(target) : value
}

function guardStatement(real: D1PreparedStatement, sql: string, mode: GuardMode): D1PreparedStatement {
  const readOnly = isReadOnlySql(sql)
  const wrapped = new Proxy(real, {
    get(target, property) {
      if (property === "bind") {
        return (...values: unknown[]) => guardStatement(target.bind(...values), sql, mode)
      }
      if (property === "run" || property === "all" || property === "first" || property === "raw") {
        if (!readOnly) return blockedStatement(mode, property)
      }
      return passThrough(target, property)
    },
  })
  statements.set(wrapped, { real, sql })
  return wrapped
}

type D1Like = Pick<D1Database, "prepare" | "batch">

/** Runs the reads of a batch; writes (and statements the guard never saw) are rejected or dropped. */
async function guardedBatch(target: D1Like, batch: readonly D1PreparedStatement[], mode: GuardMode): Promise<unknown[]> {
  const reads: D1PreparedStatement[] = []
  const slots: (number | null)[] = []
  for (const statement of batch) {
    const info = statements.get(statement)
    if (info && isReadOnlySql(info.sql)) {
      slots.push(reads.length)
      reads.push(info.real)
    } else {
      if (mode === "reject") return rejected("database write")
      slots.push(null)
    }
  }
  const results: unknown[] = reads.length > 0 ? await target.batch(reads) : []
  return slots.map((slot) => (slot === null ? emptyResult("all") : results[slot]))
}

function guardDatabase<T extends D1Like>(real: T, mode: GuardMode): T {
  return new Proxy(real, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => guardStatement(target.prepare(sql), sql, mode)
      }
      if (property === "batch") {
        return (batch: readonly D1PreparedStatement[]) => guardedBatch(target, batch, mode)
      }
      if (property === "exec") {
        return mode === "reject" ? () => rejected("database write") : async () => ({ count: 0, duration: 0 })
      }
      if (property === "dump") return () => rejected("database dump")
      if (property === "withSession") {
        const method: unknown = Reflect.get(target, property, target)
        if (typeof method !== "function") return method
        return (...args: unknown[]) => {
          const session: unknown = Reflect.apply(method, target, args)
          return isD1Like(session) ? guardDatabase(session, mode) : session
        }
      }
      return passThrough(target, property)
    },
  })
}

function isD1Like(value: unknown): value is D1Like {
  return isRecord(value) && typeof value.prepare === "function" && typeof value.batch === "function"
}

/** A D1 binding that reads normally and blocks every write. */
export function readOnlyD1(real: D1Database, mode: GuardMode = "reject"): D1Database {
  return guardDatabase(real, mode)
}

/** Storage writes that can be dropped quietly when skipping; anything else always rejects. */
const SKIPPABLE_STORAGE_METHODS = new Set(["put", "delete", "send", "sendBatch"])
const BLOCKED_STORAGE_METHODS = new Set([...SKIPPABLE_STORAGE_METHODS, "createMultipartUpload", "resumeMultipartUpload"])

/** An R2 bucket, KV namespace or queue: anything with put/delete/send. */
function isStorageLike(value: unknown): value is object {
  return isRecord(value) && (typeof value.put === "function" || typeof value.sendBatch === "function")
}

function readOnlyStorage<T extends object>(real: T, mode: GuardMode): T {
  return new Proxy(real, {
    get(target, property) {
      if (typeof property === "string" && BLOCKED_STORAGE_METHODS.has(property)) {
        if (mode === "skip" && SKIPPABLE_STORAGE_METHODS.has(property)) return async () => null
        return () => rejected(`storage ${property}`)
      }
      return passThrough(target, property)
    },
  })
}

const guardedEnvs: Record<GuardMode, WeakMap<object, CloudflareEnv>> = { reject: new WeakMap(), skip: new WeakMap() }

/**
 * The Cloudflare env with every database and storage binding read only.
 * Secrets and other bindings (AI, images, Durable Objects) pass through.
 */
export function readOnlyEnv(env: CloudflareEnv, mode: GuardMode = "reject"): CloudflareEnv {
  const cached = guardedEnvs[mode].get(env)
  if (cached) return cached
  const wrappers = new Map<string | symbol, unknown>()
  const guarded = new Proxy(env, {
    get(target, property) {
      const existing = wrappers.get(property)
      if (existing !== undefined) return existing
      const value: unknown = Reflect.get(target, property, target)
      let wrapped: unknown = value
      if (isD1Like(value)) wrapped = guardDatabase(value, mode)
      else if (isStorageLike(value)) wrapped = readOnlyStorage(value, mode)
      if (wrapped !== value) wrappers.set(property, wrapped)
      return wrapped
    },
  })
  guardedEnvs[mode].set(env, guarded)
  return guarded
}
