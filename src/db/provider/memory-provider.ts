import type { drizzle as drizzleBetterSqlite } from "drizzle-orm/better-sqlite3"
import type { DatabaseProvider, DrizzleDB } from "./interface"
import type { MemoryProviderConfig } from "./memory-types"

// Re-export types for convenience
export type { MemoryProviderConfig } from "./memory-types"

// Type declarations for better-sqlite3
// This avoids requiring the package at build time
// The package is only needed when actually using the memory provider
interface BetterSqlite3Database {
  prepare(sql: string): {
    run(...params: unknown[]): void
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
  transaction<T>(fn: () => T): () => T
  close(): void
}

type MemoryDrizzleDB = ReturnType<typeof drizzleBetterSqlite>

// In-memory SQLite provider for testing and development
// Uses better-sqlite3 in memory mode (file:":memory:")
//
// NOTE: This provider requires better-sqlite3 to be installed.
// It's designed for testing and local development only.
// Install with: bun add -d better-sqlite3 @types/better-sqlite3
export function createMemoryProvider(config?: MemoryProviderConfig): DatabaseProvider {
  let sqlite: BetterSqlite3Database | null = null
  let db: MemoryDrizzleDB | null = null

  async function initialize(): Promise<{ sqlite: BetterSqlite3Database; db: MemoryDrizzleDB }> {
    if (sqlite && db) {
      return { sqlite, db }
    }

    try {
      // Dynamic import to avoid requiring the package at build time
      const Database = (await import("better-sqlite3")).default
      const { drizzle } = await import("drizzle-orm/better-sqlite3")

      // Import all schemas
      const schemaModule = await import("../schema")
      const netsuiteSchema = await import("../schema-netsuite")
      const pluginSchema = await import("../schema-plugins")
      const agentSchema = await import("../schema-agent")
      const aiConfigSchema = await import("../schema-ai-config")
      const themeSchema = await import("../schema-theme")
      const googleSchema = await import("../schema-google")
      const dashboardSchema = await import("../schema-dashboards")
      const mcpSchema = await import("../schema-mcp")
      const conversationsSchema = await import("../schema-conversations")
      const buildertrendSchema = await import("../schema-buildertrend")

      const allSchemas = {
        ...schemaModule,
        ...netsuiteSchema,
        ...pluginSchema,
        ...agentSchema,
        ...aiConfigSchema,
        ...themeSchema,
        ...googleSchema,
        ...dashboardSchema,
        ...mcpSchema,
        ...conversationsSchema,
        ...buildertrendSchema,
      }

      sqlite = new Database(":memory:") as BetterSqlite3Database
      db = drizzle(sqlite as Parameters<typeof drizzle>[0], { schema: allSchemas })

      // Run migrations if seed data provided
      if (config?.seedData) {
        // Placeholder for seeding logic
      }

      return { sqlite, db }
    } catch (error) {
      throw new Error(
        "Failed to initialize memory provider. " +
          "Make sure better-sqlite3 is installed: bun add -d better-sqlite3 @types/better-sqlite3\n" +
          `Error: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  return {
    type: "memory",

    async getDb(): Promise<DrizzleDB> {
      const { db: initializedDb } = await initialize()
      return initializedDb as DrizzleDB
    },

    async execute(sql: string, params?: unknown[]): Promise<void> {
      const { sqlite: initializedSqlite } = await initialize()
      if (params && params.length > 0) {
        initializedSqlite.prepare(sql).run(...params)
      } else {
        initializedSqlite.prepare(sql).run()
      }
    },

    async close(): Promise<void> {
      if (sqlite) {
        sqlite.close()
        sqlite = null
        db = null
      }
    },
  }
}

// Factory for creating isolated test databases
// Each call creates a fresh in-memory database
export function createIsolatedTestDb(): DatabaseProvider {
  return createMemoryProvider()
}
