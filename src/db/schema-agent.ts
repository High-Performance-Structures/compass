import {
  index,
  sqliteTable,
  text,
  integer,
} from "drizzle-orm/sqlite-core"
import { users } from "./schema"

export const agentItems = sqliteTable("agent_items", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id"),
  type: text("type").notNull(), // "todo" | "note" | "checklist"
  title: text("title").notNull(),
  content: text("content"),
  done: integer("done", { mode: "boolean" })
    .notNull()
    .default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  parentId: text("parent_id"),
  metadata: text("metadata"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    index("agent_items_user_id_idx").on(table.userId),
  ])

// One row per carried-out Ask Jarvis confirmation; the token id as primary
// key makes each confirmation single-use (see drizzle/0207).
export const agentActionConfirmations = sqliteTable(
  "agent_action_confirmations",
  {
    tokenId: text("token_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").notNull(),
    path: text("path").notNull(),
    action: text("action").notNull(),
    confirmedAt: text("confirmed_at").notNull(),
  },
  (table) => [
    index("agent_action_confirmations_user_idx").on(
      table.userId,
      table.confirmedAt
    ),
  ]
)

export type AgentItem = typeof agentItems.$inferSelect
export type NewAgentItem = typeof agentItems.$inferInsert
