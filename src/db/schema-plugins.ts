import {
  sqliteTable,
  text,
  integer,
} from "drizzle-orm/sqlite-core"
import { users } from "./schema"

// installed plugin registry
export const plugins = sqliteTable("plugins", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  version: text("version").notNull(),
  source: text("source").notNull(),
  sourceType: text("source_type").notNull(),
  capabilities: text("capabilities").notNull(),
  requiredEnvVars: text("required_env_vars"),
  status: text("status").notNull().default("disabled"),
  statusReason: text("status_reason"),
  enabledBy: text("enabled_by").references(() => users.id),
  enabledAt: text("enabled_at"),
  installedAt: text("installed_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

// per-plugin key-value configuration
export const pluginConfig = sqliteTable("plugin_config", {
  id: text("id").primaryKey(),
  pluginId: text("plugin_id")
    .notNull()
    .references(() => plugins.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: text("value").notNull(),
  isEncrypted: integer("is_encrypted", { mode: "boolean" })
    .notNull()
    .default(false),
  updatedAt: text("updated_at").notNull(),
})

// plugin lifecycle audit log
export const pluginEvents = sqliteTable("plugin_events", {
  id: text("id").primaryKey(),
  pluginId: text("plugin_id")
    .notNull()
    .references(() => plugins.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  details: text("details"),
  userId: text("user_id").references(() => users.id),
  createdAt: text("created_at").notNull(),
})

export type Plugin = typeof plugins.$inferSelect
export type NewPlugin = typeof plugins.$inferInsert
export type PluginConfig = typeof pluginConfig.$inferSelect
export type NewPluginConfig = typeof pluginConfig.$inferInsert
export type PluginEvent = typeof pluginEvents.$inferSelect
export type NewPluginEvent = typeof pluginEvents.$inferInsert
