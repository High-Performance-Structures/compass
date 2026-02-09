/**
 * Local Database Adapter for Development (Bun Native SQLite)
 * 
 * This module provides a local SQLite database connection using Bun's native
 * SQLite implementation, replacing Cloudflare D1 for development purposes.
 * 
 * Usage: Set BYPASS_AUTH=true in .env.local to enable local mode
 */

import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
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

// Database file path
const DB_PATH = path.join(process.cwd(), ".local", "dev.db")

// Ensure .local directory exists
const localDir = path.dirname(DB_PATH)
if (!fs.existsSync(localDir)) {
  fs.mkdirSync(localDir, { recursive: true })
}

// Singleton database instance
let localDb: ReturnType<typeof drizzle> | null = null
let sqliteDb: Database | null = null

/**
 * Initialize local database connection
 */
export function initLocalDatabase(): Database {
  if (sqliteDb) return sqliteDb

  console.log("[DEV] Initializing local SQLite database at:", DB_PATH)
  
  sqliteDb = new Database(DB_PATH)
  sqliteDb.exec("PRAGMA journal_mode = WAL")
  sqliteDb.exec("PRAGMA foreign_keys = ON")
  
  return sqliteDb
}

/**
 * Get Drizzle ORM instance for local database
 */
export function getLocalDb() {
  if (localDb) return localDb

  const sqlite = initLocalDatabase()
  localDb = drizzle(sqlite, { schema: allSchemas })
  
  return localDb
}

/**
 * Clear and reset local database (useful for testing)
 */
export function resetLocalDatabase() {
  if (sqliteDb) {
    sqliteDb.close()
    sqliteDb = null
    localDb = null
  }
  
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH)
    console.log("[DEV] Local database reset")
  }
  
  // Re-initialize
  initLocalDatabase()
}

// Auto-initialize on module load
if (process.env.BYPASS_AUTH === "true") {
  initLocalDatabase()
}