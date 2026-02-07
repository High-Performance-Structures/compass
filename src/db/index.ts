import { drizzle } from "drizzle-orm/d1"
import * as schema from "./schema"
import * as netsuiteSchema from "./schema-netsuite"
import * as pluginSchema from "./schema-plugins"
import * as agentSchema from "./schema-agent"
import * as aiConfigSchema from "./schema-ai-config"
import * as googleSchema from "./schema-google"

const allSchemas = {
  ...schema,
  ...netsuiteSchema,
  ...pluginSchema,
  ...agentSchema,
  ...aiConfigSchema,
  ...googleSchema,
}

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema: allSchemas })
}
