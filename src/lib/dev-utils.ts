/**
 * Development utilities for bypassing Cloudflare authentication
 * This module provides mock implementations for local development
 */

import { getDb } from "@/db"

// Mock D1 database for development
const mockDb: ReturnType<typeof getDb> | null = null

/**
 * Initialize mock database for development
 * This creates a local SQLite connection that mimics D1 behavior
 */
export async function initMockDatabase(): Promise<ReturnType<typeof getDb>> {
  if (mockDb) return mockDb

  // For development, we'll create a mock D1 database
  // In a real implementation, this could connect to a local SQLite file
  // For now, we'll throw an error that suggests using the actual wrangler setup
  throw new Error(
    "Mock database not implemented. " +
    "Please run: wrangler dev --local or configure Cloudflare authentication"
  )
}

/**
 * Development mock of getCloudflareContext
 * Returns mock bindings when BYPASS_AUTH is enabled
 */
export async function getCloudflareContextDev() {
  const isBypassMode = process.env.BYPASS_AUTH === "true"

  if (!isBypassMode) {
    throw new Error(
      "Development mode not enabled. Set BYPASS_AUTH=true in .env.local"
    )
  }

  // Return mock context
  return {
    env: {
      // Mock D1 database - in production this would be the real D1 binding
      DB: null as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    },
    cf: {},
    ctx: {
      waitUntil: () => { },
      passThroughOnException: () => { },
    },
  }
}

/**
 * Check if we're in development bypass mode
 */
export function isDevelopmentBypass(): boolean {
  return process.env.BYPASS_AUTH === "true" && process.env.NODE_ENV === "development"
}