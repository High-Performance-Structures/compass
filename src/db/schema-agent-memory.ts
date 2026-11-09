/*
 * Jarvis (AI assistant) memory: agent conversations, agent memories, and
 * Slab persistent memory.
 */

import {
  index,
  sqliteTable,
  text,
  integer,
  real,
} from "drizzle-orm/sqlite-core"

import { users } from "./schema-identity"

// Agent memory tables for ElizaOS
export const agentConversations = sqliteTable("agent_conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  lastMessageAt: text("last_message_at").notNull(),
  createdAt: text("created_at").notNull(),
},
  (table) => [
    index("agent_conversations_user_id_idx").on(table.userId),
  ])

export const agentMemories = sqliteTable("agent_memories", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => agentConversations.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  embedding: text("embedding"), // JSON array of floats for vector search
  metadata: text("metadata"), // JSON object for action results, ui specs, etc.
  createdAt: text("created_at").notNull(),
},
  (table) => [
    index("agent_memories_user_id_idx").on(table.userId),
    index("agent_memories_conversation_id_idx").on(table.conversationId),
  ])

export type AgentConversation = typeof agentConversations.$inferSelect

export type NewAgentConversation = typeof agentConversations.$inferInsert

export type AgentMemory = typeof agentMemories.$inferSelect

export type NewAgentMemory = typeof agentMemories.$inferInsert

// Slab persistent memory
export const slabMemories = sqliteTable("slab_memories", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  memoryType: text("memory_type").notNull(), // preference | workflow | fact | decision
  tags: text("tags"), // comma-separated, lowercase
  importance: real("importance").notNull().default(0.7),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: text("last_accessed_at"),
  createdAt: text("created_at").notNull(),
},
  (table) => [
    index("slab_memories_user_id_idx").on(table.userId),
  ])

export type SlabMemory = typeof slabMemories.$inferSelect

export type NewSlabMemory = typeof slabMemories.$inferInsert
