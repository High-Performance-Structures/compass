import type { DrizzleD1Database } from "drizzle-orm/d1"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"

// Union type for all supported database types
export type DrizzleDB =
  | DrizzleD1Database<Record<string, unknown>>
  | BetterSQLite3Database<Record<string, unknown>>

export type ProviderType = "d1" | "tauri" | "memory"

export interface DatabaseProvider {
  readonly type: ProviderType
  getDb(): Promise<DrizzleDB>
  execute(sql: string, params?: unknown[]): Promise<void>
  transaction<T>(fn: (db: DrizzleDB) => Promise<T>): Promise<T>
  close?(): Promise<void>
}

// Platform detection for Tauri desktop
// Safe for SSR - returns false when window is undefined
export function isTauri(): boolean {
  if (typeof window === "undefined") return false
  return "__TAURI__" in window
}

// Check if running in Cloudflare Workers (D1 available)
export function isCloudflareWorker(): boolean {
  if (typeof globalThis === "undefined") return false
  return (
    "caches" in globalThis &&
    typeof (globalThis as unknown as { caches: unknown }).caches !==
      "undefined" &&
    // Additional check for Cloudflare-specific APIs
    typeof (globalThis as unknown as { WebSocketPair?: unknown })
      .WebSocketPair !== "undefined"
  )
}

// Detect current platform
export function detectPlatform(): ProviderType {
  if (isTauri()) return "tauri"
  if (isCloudflareWorker()) return "d1"
  return "memory"
}
