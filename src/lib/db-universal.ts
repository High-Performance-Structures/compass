/**
 * Universal Database Access
 * 
 * This module provides a unified interface for database access that automatically
 * switches between local SQLite (development) and Cloudflare D1 (production).
 */

import * as schema from "@/db/schema"
import * as netsuiteSchema from "@/db/schema-netsuite"
import * as pluginSchema from "@/db/schema-plugins"
import * as agentSchema from "@/db/schema-agent"
import * as aiConfigSchema from "@/db/schema-ai-config"
import * as themeSchema from "@/db/schema-theme"
import * as googleSchema from "@/db/schema-google"
import * as dashboardSchema from "@/db/schema-dashboards"
import path from "path"
import fs from "fs"

const allSchemas = {
  ...schema,
  ...netsuiteSchema,
  ...pluginSchema,
  ...agentSchema,
  ...aiConfigSchema,
  ...themeSchema,
  ...googleSchema,
  ...dashboardSchema,
}

// Check if we're in local development mode
// BYPASS_AUTH alone is sufficient since it's explicitly set in .env.local
const isLocalDev = process.env.BYPASS_AUTH === "true"

// Check if running in Bun runtime
const isBun = typeof process !== "undefined" && process.versions && process.versions.bun !== undefined

// Local database instance
let localDb: any | null = null // eslint-disable-line @typescript-eslint/no-explicit-any
let sqliteDb: any | null = null // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Initialize local SQLite database using Bun or better-sqlite3
 */
async function initLocalDb(): Promise<unknown> {
  if (sqliteDb) return sqliteDb

  const DB_PATH = path.join(process.cwd(), ".local", "dev.db")

  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  }

  if (isBun) {
    // Use Bun's native SQLite
    const { Database } = await import("bun:sqlite")
    const db = new Database(DB_PATH)
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("PRAGMA foreign_keys = ON")
    sqliteDb = db
  } else {
    // Use better-sqlite3 for Node.js
    const Database = (await import("better-sqlite3")).default
    const db = new Database(DB_PATH)
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("PRAGMA foreign_keys = ON")
    sqliteDb = db
  }

  return sqliteDb
}

/**
 * Get database instance - automatically chooses local or Cloudflare
 */
export async function getDb() {
  if (isLocalDev) {
    // Use local SQLite
    if (!localDb) {
      const sqlite = await initLocalDb()
      if (isBun) {
        const { drizzle } = await import("drizzle-orm/bun-sqlite")
        localDb = drizzle(sqlite as import("bun:sqlite").Database, { schema: allSchemas })
      } else {
        const { drizzle } = await import("drizzle-orm/better-sqlite3")
        localDb = drizzle(sqlite as import("better-sqlite3").Database, { schema: allSchemas })
      }
    }
    return localDb
  }

  // Use Cloudflare D1
  const { getCloudflareContext } = await import("@opennextjs/cloudflare")
  const { env } = await getCloudflareContext()
  const { getDb: getCloudflareDb } = await import("@/db")
  return getCloudflareDb(env.DB)
}