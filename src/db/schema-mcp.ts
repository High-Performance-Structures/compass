import {
  sqliteTable,
  text,
  integer,
} from "drizzle-orm/sqlite-core"
import { users } from "./schema"

export const mcpApiKeys = sqliteTable("mcp_api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  scopes: text("scopes").notNull(), // JSON array: ["read","write","admin"]
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at"),
  isActive: integer("is_active", { mode: "boolean" })
    .notNull()
    .default(true),
})

export const mcpUsage = sqliteTable("mcp_usage", {
  id: text("id").primaryKey(),
  apiKeyId: text("api_key_id")
    .notNull()
    .references(() => mcpApiKeys.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  success: integer("success", { mode: "boolean" }).notNull(),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms").notNull(),
  createdAt: text("created_at").notNull(),
})

export type McpApiKey = typeof mcpApiKeys.$inferSelect
export type NewMcpApiKey = typeof mcpApiKeys.$inferInsert
export type McpUsage = typeof mcpUsage.$inferSelect
export type NewMcpUsage = typeof mcpUsage.$inferInsert
