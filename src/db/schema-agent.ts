import {
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
})

export type AgentItem = typeof agentItems.$inferSelect
export type NewAgentItem = typeof agentItems.$inferInsert
