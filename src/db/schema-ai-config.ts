import {
  sqliteTable,
  text,
  integer,
} from "drizzle-orm/sqlite-core"
import { users, agentConversations } from "./schema"

// singleton config row (id = "global")
export const agentConfig = sqliteTable("agent_config", {
  id: text("id").primaryKey(),
  modelId: text("model_id").notNull(),
  modelName: text("model_name").notNull(),
  provider: text("provider").notNull(),
  promptCost: text("prompt_cost").notNull(),
  completionCost: text("completion_cost").notNull(),
  contextLength: integer("context_length").notNull(),
  maxCostPerMillion: text("max_cost_per_million"),
  allowUserSelection: integer("allow_user_selection")
    .notNull()
    .default(1),
  updatedBy: text("updated_by")
    .notNull()
    .references(() => users.id),
  updatedAt: text("updated_at").notNull(),
})

// per-user model preference
export const userModelPreference = sqliteTable(
  "user_model_preference",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id),
    modelId: text("model_id").notNull(),
    promptCost: text("prompt_cost").notNull(),
    completionCost: text("completion_cost").notNull(),
    updatedAt: text("updated_at").notNull(),
  }
)

// one row per streamText invocation
export const agentUsage = sqliteTable("agent_usage", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => agentConversations.id, {
      onDelete: "cascade",
    }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  modelId: text("model_id").notNull(),
  promptTokens: integer("prompt_tokens")
    .notNull()
    .default(0),
  completionTokens: integer("completion_tokens")
    .notNull()
    .default(0),
  totalTokens: integer("total_tokens")
    .notNull()
    .default(0),
  estimatedCost: text("estimated_cost").notNull(),
  createdAt: text("created_at").notNull(),
})

export type AgentConfig = typeof agentConfig.$inferSelect
export type NewAgentConfig = typeof agentConfig.$inferInsert
export type AgentUsage = typeof agentUsage.$inferSelect
export type NewAgentUsage = typeof agentUsage.$inferInsert
export type UserModelPreference =
  typeof userModelPreference.$inferSelect
export type NewUserModelPreference =
  typeof userModelPreference.$inferInsert
