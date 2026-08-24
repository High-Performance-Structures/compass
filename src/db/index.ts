import { drizzle } from "drizzle-orm/d1"
import * as schema from "./schema"
import * as netsuiteSchema from "./schema-netsuite"
import * as pluginSchema from "./schema-plugins"
import * as agentSchema from "./schema-agent"
import * as aiConfigSchema from "./schema-ai-config"
import * as themeSchema from "./schema-theme"
import * as googleSchema from "./schema-google"
import * as dashboardSchema from "./schema-dashboards"
import * as mcpSchema from "./schema-mcp"
import * as conversationsSchema from "./schema-conversations"
import * as jarvisSchema from "./schema-jarvis"
import * as sageSchema from "./schema-sage"
import * as buildertrendSchema from "./schema-buildertrend"
import * as estimatesSchema from "./schema-estimates"
import * as nuTechSchema from "./schema-nutech"
import * as templateSchema from "./schema-templates"
import * as warrantySchema from "./schema-warranty"
import * as contractSchema from "./schema-contracts"

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
  ...jarvisSchema,
  ...sageSchema,
  ...buildertrendSchema,
  ...estimatesSchema,
  ...nuTechSchema,
  ...templateSchema,
  ...warrantySchema,
  ...contractSchema,
}

// Legacy function - kept for backwards compatibility
// Prefer using the provider interface from ./provider for new code
export function getDb(d1: D1Database) {
  return drizzle(d1, { schema: allSchemas })
}

// Re-export provider interface for platform-agnostic database access
export type {
  DatabaseProviderInterface,
  DrizzleDB,
  ProviderType,
  DatabaseProviderProps,
} from "./provider"

export {
  isElectron,
  isCloudflareWorker,
  detectPlatform,
  createD1Provider,
  getD1FromContext,
  createElectronProvider,
  DatabaseProvider,
  useDatabase,
  useDb,
  getServerDb,
} from "./provider"
export type { MemoryProviderConfig } from "./provider"
