import { drizzle } from "drizzle-orm/d1"
import * as schema from "./schema"
import * as netsuiteSchema from "./schema-netsuite"
import * as pluginSchema from "./schema-plugins"
import * as agentSchema from "./schema-agent"

const allSchemas = {
  ...schema,
  ...netsuiteSchema,
  ...pluginSchema,
  ...agentSchema,
}

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema: allSchemas })
}
