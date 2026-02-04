import { drizzle } from "drizzle-orm/d1"
import * as schema from "./schema"
import * as netsuiteSchema from "./schema-netsuite"

const allSchemas = { ...schema, ...netsuiteSchema }

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema: allSchemas })
}
