/**
 * Cloudflare Context Shim
 * 
 * This module intercepts Cloudflare Workers API calls and redirects them
 * to local equivalents when BYPASS_AUTH is enabled.
 * 
 * Import this module early in your application to enable the shim.
 */

import { getLocalDb, initLocalDatabase } from "./local-db"
import type { D1Database, D1PreparedStatement, D1Result, D1ExecResult } from "@cloudflare/workers-types"

// Check if bypass mode is enabled
const isBypassMode = process.env.BYPASS_AUTH === "true"

if (isBypassMode) {
  console.log("[DEV] Cloudflare bypass mode enabled - using local SQLite database")

  // Initialize local database
  initLocalDatabase()
}

/**
 * Mock D1 database that wraps local SQLite
 */
class LocalD1Wrapper implements D1Database {
  private db: ReturnType<typeof getLocalDb>

  constructor() {
    this.db = getLocalDb()
  }

  async prepare(query: string): Promise<D1PreparedStatement> {
    const stmt = (this.db as any).query(query) // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
      bind: (...values: any[]) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        first: async () => stmt.get(...values),
        run: async () => stmt.run(...values),
        all: async () => stmt.all(...values),
        raw: async () => stmt.all(...values),
      }),
      first: async () => stmt.get(),
      run: async () => stmt.run(),
      all: async () => stmt.all(),
      raw: async () => stmt.all(),
    } as D1PreparedStatement
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0)
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = []
    for (const stmt of statements) {
      results.push(await stmt.all<T>())
    }
    return results
  }

  async exec(query: string): Promise<D1ExecResult> {
    const sqlite = (this.db as any).database // eslint-disable-line @typescript-eslint/no-explicit-any
    const result = sqlite.exec(query)
    return {
      count: result.changes || 0,
      duration: 0,
    }
  }
}

/**
 * Get Cloudflare context - returns local mock when in bypass mode
 */
export async function getCloudflareContext(): Promise<{
  env: { DB: D1Database }
  cf: any // eslint-disable-line @typescript-eslint/no-explicit-any
  ctx: { waitUntil: (...args: any[]) => void; passThroughOnException: (...args: any[]) => void } // eslint-disable-line @typescript-eslint/no-explicit-any
}> {
  if (!isBypassMode) {
    // Use real Cloudflare context
    const opennext = await import("@opennextjs/cloudflare")
    return opennext.getCloudflareContext()
  }

  // Return local development context
  return {
    env: {
      DB: new LocalD1Wrapper(),
    },
    cf: {
      // Mock CF properties
      country: "US",
      region: "Texas",
      city: "Austin",
      timezone: "America/Chicago",
    },
    ctx: {
      waitUntil: () => { },
      passThroughOnException: () => { },
    },
  }
}