/**
 * Cloudflare Context - Universal Export
 * 
 * This module provides a unified interface for Cloudflare Workers context.
 * When BYPASS_AUTH is enabled, it uses local SQLite instead of Cloudflare D1.
 * Otherwise, it delegates to the real @opennextjs/cloudflare package.
 */

import type { D1Database } from "@cloudflare/workers-types"

// Check if we're in development bypass mode
const isBypassMode = typeof process !== "undefined" && process.env.BYPASS_AUTH === "true"

interface CloudflareContext {
  env: { DB: D1Database }
  cf: any // eslint-disable-line @typescript-eslint/no-explicit-any
  ctx: { waitUntil: (...args: any[]) => void; passThroughOnException: (...args: any[]) => void } // eslint-disable-line @typescript-eslint/no-explicit-any
}

// In bypass mode, provide local SQLite implementation
if (isBypassMode) {
  console.log("[DEV] Using local SQLite database (Cloudflare bypass mode)")
}

/**
 * Get Cloudflare context - automatically chooses local or remote based on environment
 */
export async function getCloudflareContext(): Promise<CloudflareContext> {
  if (isBypassMode) {
    // Dynamic import to avoid loading better-sqlite3 when not needed
    const { getCloudflareContext: getLocalContext } = await import("./cloudflare-shim")
    return getLocalContext()
  }

  // Use real Cloudflare context
  const opennext = await import("@opennextjs/cloudflare")
  return opennext.getCloudflareContext()
}