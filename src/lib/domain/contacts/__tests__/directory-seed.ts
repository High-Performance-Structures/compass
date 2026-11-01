import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { d1Over } from "@/lib/domain/__tests__/sqlite-d1"

type Sqlite = InstanceType<typeof Database>

export type DirectorySeedCounts = {
  readonly vendors: number
  readonly vendorPeople: number
  readonly customers: number
  readonly customerPeople: number
  readonly tradeDocs: number
}

export type QueryStats = { queries: number; rows: number; maxParams: number }

/** Every migration replayed on a fresh database, as CI's schema check does. */
export function migratedDatabase(): Sqlite {
  const sqlite = new Database(":memory:")
  const dir = join(process.cwd(), "drizzle")
  for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
  }
  return sqlite
}

/**
 * A D1 binding that counts statements and returned rows, and enforces D1's
 * 100 bound-parameter limit.
 */
export function countingD1(sqlite: Sqlite): { readonly d1: unknown; readonly stats: QueryStats } {
  const stats: QueryStats = { queries: 0, rows: 0, maxParams: 0 }
  const inner = Object(d1Over(sqlite))
  const prepare: unknown = Reflect.get(inner, "prepare")
  if (typeof prepare !== "function") throw new Error("d1Over has no prepare")
  const wrap = (statement: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...statement }
    out.bind = (...values: unknown[]): unknown => {
      stats.maxParams = Math.max(stats.maxParams, values.length)
      if (values.length > 100) throw new Error(`D1_ERROR: too many SQL variables (${values.length})`)
      const bind = statement.bind
      if (typeof bind !== "function") throw new Error("statement has no bind")
      return wrap(bind(...values))
    }
    for (const method of ["all", "raw", "first", "run"] as const) {
      const fn = statement[method]
      if (typeof fn !== "function") continue
      out[method] = async (): Promise<unknown> => {
        stats.queries += 1
        const result: unknown = await fn()
        if (Array.isArray(result)) stats.rows += result.length
        else {
          const results: unknown = Reflect.get(Object(result), "results")
          if (Array.isArray(results)) stats.rows += results.length
        }
        return result
      }
    }
    return out
  }
  // A batch is one D1 round trip, run as a unit. A savepoint (not BEGIN) lets
  // tests wrap each case in their own rollback.
  const batch = async (statements: readonly { run: () => Promise<unknown> }[]): Promise<unknown[]> => {
    sqlite.exec("SAVEPOINT d1_batch")
    try {
      const results: unknown[] = []
      for (const statement of statements) results.push(await statement.run())
      sqlite.exec("RELEASE d1_batch")
      return results
    } catch (error) {
      sqlite.exec("ROLLBACK TO d1_batch")
      sqlite.exec("RELEASE d1_batch")
      throw error
    }
  }
  return {
    d1: { ...inner, batch, prepare: (query: string): unknown => wrap(prepare(query)) },
    stats,
  }
}

const FIRST = ["Alex", "Blake", "Casey", "Dana", "Emery", "Finley", "Gray", "Harper", "Jordan", "Kai", "Logan", "Morgan"]
const LAST = ["Reed", "Stone", "Hart", "Lane", "Brooks", "Cole", "Wells", "Fox", "Shaw", "Price", "Ward", "Hayes"]
const TRADES = ["Concrete", "Framing", "Electric", "Plumbing", "Roofing", "Drywall", "Excavation", "HVAC", "Paint", "Glass"]
const CATEGORIES = ["Subcontractor", "Supplier", "Consultant", "Governmental Agency", "Miscellaneous Vendor"]

/** Production-shaped directory volumes for one organization. */
export function seedDirectory(sqlite: Sqlite, counts: DirectorySeedCounts, orgId = "org-a"): void {
  const now = "2026-10-01T00:00:00.000Z"
  sqlite.prepare("INSERT OR IGNORE INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES (?, ?, ?, 'company', 1, ?, ?)").run(orgId, orgId, orgId, now, now)
  const vendor = sqlite.prepare("INSERT INTO vendors (id, name, category, email, phone, address, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
  const vendorPerson = sqlite.prepare("INSERT INTO vendor_contacts (id, vendor_id, name, title, email, phone, is_primary, active, created_at, updated_at) VALUES (?, ?, ?, 'Estimator', ?, ?, ?, 1, ?, ?)")
  const customer = sqlite.prepare("INSERT INTO customers (id, name, company, email, phone, address, notes, organization_id, created_at, updated_at, relationship_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
  const customerPerson = sqlite.prepare("INSERT INTO customer_contacts (id, customer_id, name, email, phone, is_primary, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)")
  const doc = sqlite.prepare("INSERT INTO vendor_trade_documents (id, organization_id, vendor_id, doc_type, kind, expires_on, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, 'document', '2027-06-01', 'Seed', ?, ?)")
  sqlite.exec("BEGIN")
  for (let i = 0; i < counts.vendors; i += 1) {
    const trade = TRADES[i % TRADES.length] ?? "Trade"
    vendor.run(`${orgId}-vendor-${i}`, `${trade} ${LAST[i % LAST.length]} ${i} LLC`,
      i % 97 === 0 ? "Internal" : CATEGORIES[i % CATEGORIES.length],
      `office${i}@${trade.toLowerCase()}${i}.example`, `(719) 555-${String(10000 + i).slice(-4)}`,
      `${100 + i} Main St, Colorado Springs, CO 80903`, orgId, now, now)
  }
  for (let i = 0; i < counts.vendorPeople; i += 1) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}${i}`
    vendorPerson.run(`${orgId}-vp-${i}`, `${orgId}-vendor-${i % Math.max(1, counts.vendors)}`, name,
      `${name.replace(/\s/g, ".").toLowerCase()}@crew.example`, `719-444-${String(10000 + i).slice(-4)}`,
      i < counts.vendors ? 1 : 0, now, now)
  }
  for (let i = 0; i < counts.customers; i += 1) {
    customer.run(`${orgId}-customer-${i}`, `${FIRST[i % FIRST.length]} ${LAST[(i * 5) % LAST.length]} Residence ${i}`,
      i % 3 === 0 ? `Holdings ${i}` : null, `owner${i}@home.example`, `(303) 555-${String(10000 + i).slice(-4)}`,
      `${200 + i} Pine Rd, Woodland Park, CO`, "Long notes ".repeat(20), orgId, now, now, i % 4 === 0 ? "lead" : "client")
  }
  for (let i = 0; i < counts.customerPeople; i += 1) {
    customerPerson.run(`${orgId}-cp-${i}`, `${orgId}-customer-${i % Math.max(1, counts.customers)}`,
      `${FIRST[(i + 3) % FIRST.length]} Spouse${i}`, `spouse${i}@home.example`, `720-333-${String(10000 + i).slice(-4)}`, now, now)
  }
  for (let i = 0; i < counts.tradeDocs; i += 1) {
    doc.run(`${orgId}-doc-${i}`, orgId, `${orgId}-vendor-${i % Math.max(1, counts.vendors)}`, i % 2 === 0 ? "w9" : "coi", now, now)
  }
  sqlite.exec("COMMIT")
}

export const PRODUCTION_SCALE: DirectorySeedCounts = {
  vendors: 1500,
  vendorPeople: 3000,
  customers: 1500,
  customerPeople: 1500,
  tradeDocs: 1200,
}
