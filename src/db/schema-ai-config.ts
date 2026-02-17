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

// per-user provider configuration
export const userProviderConfig = sqliteTable(
  "user_provider_config",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id),
    providerType: text("provider_type").notNull(), // anthropic-oauth | anthropic-key | openrouter | ollama | custom
    apiKey: text("api_key"), // encrypted, nullable
    baseUrl: text("base_url"), // nullable
    modelOverrides: text("model_overrides"), // JSON, nullable
    isActive: integer("is_active").notNull().default(1),
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

// per-user Anthropic OAuth tokens (separate from provider config
// because OAuth needs refresh token + expiry tracking)
export const anthropicOauthTokens = sqliteTable(
  "anthropic_oauth_tokens",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    expiresAt: text("expires_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  }
)

export type AgentConfig = typeof agentConfig.$inferSelect
export type NewAgentConfig = typeof agentConfig.$inferInsert
export type UserProviderConfig = typeof userProviderConfig.$inferSelect
export type NewUserProviderConfig = typeof userProviderConfig.$inferInsert
export type AgentUsage = typeof agentUsage.$inferSelect
export type NewAgentUsage = typeof agentUsage.$inferInsert
export type UserModelPreference =
  typeof userModelPreference.$inferSelect
export type NewUserModelPreference =
  typeof userModelPreference.$inferInsert
export type AnthropicOauthToken =
  typeof anthropicOauthTokens.$inferSelect
export type NewAnthropicOauthToken =
  typeof anthropicOauthTokens.$inferInsert
