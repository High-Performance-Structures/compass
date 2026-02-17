import {
  sqliteTable,
  text,
  integer,
} from "drizzle-orm/sqlite-core"
import { users, organizations } from "./schema"

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

export const mcpServers = sqliteTable("mcp_servers", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(), // used as tool name prefix
  transport: text("transport").notNull(), // "stdio" | "http"
  command: text("command"), // stdio only
  args: text("args"), // stdio: JSON array
  env: text("env"), // stdio: JSON env vars
  url: text("url"), // http only
  headers: text("headers"), // http: JSON headers
  isEnabled: integer("is_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
})

export type McpServer = typeof mcpServers.$inferSelect
export type NewMcpServer = typeof mcpServers.$inferInsert
