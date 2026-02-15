import type { DatabaseProvider, DrizzleDB } from "./interface"

export interface TauriProviderConfig {
  dbName?: string
}

// Type for the Tauri SQL plugin database instance
interface TauriSqlDb {
  select<T>(query: string, params?: unknown[]): Promise<T[]>
  execute(query: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }>
}

// Lazy-loaded database instance
let dbInstance: TauriSqlDb | null = null
let dbInitPromise: Promise<TauriSqlDb> | null = null

// LocalStorage key for queue persistence backup
const QUEUE_BACKUP_KEY = "compass_mutation_queue_backup"

async function loadSqlPlugin(): Promise<{ default: { load: (path: string) => Promise<TauriSqlDb> } }> {
  try {
    const sqlPlugin = await import("@tauri-apps/plugin-sql")
    return sqlPlugin as { default: { load: (path: string) => Promise<TauriSqlDb> } }
  } catch (error) {
    throw new Error(
      "Failed to load @tauri-apps/plugin-sql. " +
        "Make sure the plugin is installed and Tauri is properly configured.\n" +
        `Error: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

async function initializeDatabase(config?: TauriProviderConfig): Promise<TauriSqlDb> {
  if (dbInstance) {
    return dbInstance
  }

  // Prevent concurrent initialization
  if (dbInitPromise) {
    return dbInitPromise
  }

  dbInitPromise = (async () => {
    const { default: Database } = await loadSqlPlugin()
    const dbName = config?.dbName ?? "sqlite:compass.db"

    dbInstance = await Database.load(dbName)
    return dbInstance
  })()

  try {
    return await dbInitPromise
  } catch (error) {
    dbInitPromise = null
    throw error
  }
}

// Tauri provider implementation using @tauri-apps/plugin-sql
export function createTauriProvider(config?: TauriProviderConfig): DatabaseProvider {
  return {
    type: "tauri" as const,

    async getDb(): Promise<DrizzleDB> {
      const db = await initializeDatabase(config)

      // Return a Drizzle-compatible wrapper
      // The Tauri SQL plugin doesn't directly support Drizzle ORM,
      // so we provide raw query access through execute()
      // This is sufficient for the sync layer's needs
      return {
        // Minimal Drizzle-like interface for sync operations
        // Actual queries should go through execute() method
        _tauriDb: db,
      } as unknown as DrizzleDB
    },

    async execute(sql: string, params?: unknown[]): Promise<void> {
      const db = await initializeDatabase(config)

      // Determine if this is a SELECT query
      const normalizedSql = sql.trim().toUpperCase()
      const isSelect = normalizedSql.startsWith("SELECT")

      if (isSelect) {
        // For SELECT queries, we still execute but discard results
        // Use select() for queries that need results
        await db.select(sql, params)
      } else {
        // For INSERT, UPDATE, DELETE
        await db.execute(sql, params)
      }
    },

    async transaction<T>(fn: (db: DrizzleDB) => Promise<T>): Promise<T> {
      const db = await initializeDatabase(config)

      // Begin transaction
      await db.execute("BEGIN TRANSACTION")

      try {
        // Execute the transaction function with a wrapped DB
        const result = await fn({
          _tauriDb: db,
        } as unknown as DrizzleDB)

        await db.execute("COMMIT")
        return result
      } catch (error) {
        await db.execute("ROLLBACK")
        throw error
      }
    },

    async close(): Promise<void> {
      // The Tauri SQL plugin doesn't have a close method in v2
      // The database connection is managed by the plugin
      dbInstance = null
      dbInitPromise = null
    },
  }
}

// Query helper for SELECT queries with typed results
export async function query<T>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const db = await initializeDatabase()
  return db.select<T>(sql, params)
}

// Execute helper for INSERT/UPDATE/DELETE with result info
export async function executeStatement(
  sql: string,
  params?: unknown[]
): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  const db = await initializeDatabase()
  return db.execute(sql, params)
}

// Queue persistence utilities
// These provide localStorage backup for mutation queue data

interface QueuedMutation {
  id: string
  operation: "insert" | "update" | "delete"
  tableName: string
  recordId: string
  payload: string | null
  vectorClock: string
  status: "pending" | "processing" | "completed" | "failed"
  retryCount: number
  errorMessage: string | null
  createdAt: string
  processAfter: string | null
}

export function persistQueueToLocalStorage(mutations: QueuedMutation[]): void {
  try {
    const data = JSON.stringify({
      version: 1,
      timestamp: Date.now(),
      mutations,
    })
    localStorage.setItem(QUEUE_BACKUP_KEY, data)
  } catch (error) {
    console.error("Failed to persist mutation queue to localStorage:", error)
  }
}

export function restoreQueueFromLocalStorage(): QueuedMutation[] | null {
  try {
    const data = localStorage.getItem(QUEUE_BACKUP_KEY)
    if (!data) return null

    const parsed = JSON.parse(data) as {
      version: number
      timestamp: number
      mutations: QueuedMutation[]
    }

    // Validate version
    if (parsed.version !== 1) {
      console.warn("Unknown queue backup version, skipping restore")
      return null
    }

    // Only restore pending mutations that are less than 24 hours old
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours
    const isRecent = Date.now() - parsed.timestamp < maxAge

    if (!isRecent) {
      console.info("Queue backup is too old, skipping restore")
      clearQueueBackup()
      return null
    }

    // Filter to only pending mutations
    const pendingMutations = parsed.mutations.filter(
      (m) => m.status === "pending" || m.status === "processing"
    )

    return pendingMutations.length > 0 ? pendingMutations : null
  } catch (error) {
    console.error("Failed to restore mutation queue from localStorage:", error)
    return null
  }
}

export function clearQueueBackup(): void {
  try {
    localStorage.removeItem(QUEUE_BACKUP_KEY)
  } catch {
    // Ignore errors
  }
}

// Get current pending mutation count from localStorage backup
export function getBackupQueueCount(): number {
  const mutations = restoreQueueFromLocalStorage()
  return mutations?.length ?? 0
}
