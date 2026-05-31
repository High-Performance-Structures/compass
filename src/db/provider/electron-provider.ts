import type { DatabaseProvider, DrizzleDB } from "./interface"

export interface ElectronProviderConfig {
  readonly dbName?: string
}

const QUEUE_BACKUP_KEY = "compass_mutation_queue_backup"

export function createElectronProvider(config?: ElectronProviderConfig): DatabaseProvider {
  void config

  return {
    type: "electron",

    async getDb(): Promise<DrizzleDB> {
      throw new Error("Electron desktop uses the hosted Compass data backend")
    },

    async execute(sql: string, params?: unknown[]): Promise<void> {
      void sql
      void params
      throw new Error("Electron desktop does not expose raw SQL IPC")
    },

    async transaction<T>(fn: (db: DrizzleDB) => Promise<T>): Promise<T> {
      void fn
      throw new Error("Electron desktop does not expose raw SQL IPC")
    },

    async close(): Promise<void> {
      return
    },
  }
}

export async function query<T>(
  sql: string,
  params?: readonly unknown[],
): Promise<readonly T[]> {
  void sql
  void params
  return [] as readonly T[]
}

export async function executeStatement(
  sql: string,
  params?: readonly unknown[],
): Promise<{ readonly rowsAffected: number; readonly lastInsertId?: number }> {
  void sql
  void params
  return { rowsAffected: 0 }
}

interface QueuedMutation {
  readonly id: string
  readonly operation: "insert" | "update" | "delete"
  readonly tableName: string
  readonly recordId: string
  readonly payload: string | null
  readonly vectorClock: string
  readonly status: "pending" | "processing" | "completed" | "failed"
  readonly retryCount: number
  readonly errorMessage: string | null
  readonly createdAt: string
  readonly processAfter: string | null
}

export function persistQueueToLocalStorage(mutations: readonly QueuedMutation[]): void {
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

export function restoreQueueFromLocalStorage(): readonly QueuedMutation[] | null {
  try {
    const data = localStorage.getItem(QUEUE_BACKUP_KEY)
    if (!data) return null

    const parsed = JSON.parse(data) as {
      version: number
      timestamp: number
      mutations: QueuedMutation[]
    }

    if (parsed.version !== 1) return null

    const maxAge = 24 * 60 * 60 * 1000
    if (Date.now() - parsed.timestamp > maxAge) {
      clearQueueBackup()
      return null
    }

    const pendingMutations = parsed.mutations.filter(
      (m) => m.status === "pending" || m.status === "processing",
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
    // Ignore localStorage errors.
  }
}

export function getBackupQueueCount(): number {
  try {
    const data = localStorage.getItem(QUEUE_BACKUP_KEY)
    if (!data) return 0

    const parsed = JSON.parse(data) as {
      version: number
      timestamp: number
      mutations: QueuedMutation[]
    }

    const maxAge = 24 * 60 * 60 * 1000
    if (Date.now() - parsed.timestamp > maxAge) return 0

    return parsed.mutations.filter(
      (m) => m.status === "pending" || m.status === "processing",
    ).length
  } catch {
    return 0
  }
}
