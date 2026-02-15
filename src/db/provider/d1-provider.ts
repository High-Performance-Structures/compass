import { drizzle } from "drizzle-orm/d1"
import * as schema from "../schema"
import * as netsuiteSchema from "../schema-netsuite"
import * as pluginSchema from "../schema-plugins"
import * as agentSchema from "../schema-agent"
import * as aiConfigSchema from "../schema-ai-config"
import * as themeSchema from "../schema-theme"
import * as googleSchema from "../schema-google"
import * as dashboardSchema from "../schema-dashboards"
import * as mcpSchema from "../schema-mcp"
import * as conversationsSchema from "../schema-conversations"
import type { DatabaseProvider, DrizzleDB } from "./interface"

const allSchemas = {
  ...schema,
  ...netsuiteSchema,
  ...pluginSchema,
  ...agentSchema,
  ...aiConfigSchema,
  ...themeSchema,
  ...googleSchema,
  ...dashboardSchema,
  ...mcpSchema,
  ...conversationsSchema,
}

type D1DrizzleDB = ReturnType<typeof createD1Drizzle>

function createD1Drizzle(d1: D1Database) {
  return drizzle(d1, { schema: allSchemas })
}

export interface D1ProviderConfig {
  getD1Database: () => D1Database | Promise<D1Database>
}

export function createD1Provider(config: D1ProviderConfig): DatabaseProvider {
  let cachedDb: D1DrizzleDB | null = null

  return {
    type: "d1",

    async getDb(): Promise<DrizzleDB> {
      if (cachedDb) return cachedDb as DrizzleDB

      const d1 = await config.getD1Database()
      cachedDb = createD1Drizzle(d1)
      return cachedDb as DrizzleDB
    },

    async execute(sql: string, params?: unknown[]): Promise<void> {
      const d1 = await config.getD1Database()
      if (params && params.length > 0) {
        await d1.prepare(sql).bind(...params).run()
      } else {
        await d1.prepare(sql).run()
      }
    },

    async transaction<T>(fn: (db: DrizzleDB) => Promise<T>): Promise<T> {
      const db = await this.getDb()
      // D1 batch provides transaction-like semantics
      // For true transactions, we need to use db.batch()
      // This is a simplified version - full transaction support
      // requires the batch API
      return fn(db)
    },
  }
}

// Helper to get D1 from Cloudflare context
// This mirrors the existing getCloudflareContext pattern
export async function getD1FromContext(): Promise<D1Database> {
  // Dynamic import to avoid issues in non-Cloudflare environments
  const { getCloudflareContext } = await import("@opennextjs/cloudflare")
  const ctx = await getCloudflareContext()
  return ctx.env.DB
}
