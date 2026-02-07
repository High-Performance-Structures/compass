import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { users } from "./schema"

export const customDashboards = sqliteTable(
  "custom_dashboards",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    specData: text("spec_data").notNull(),
    queries: text("queries").notNull(),
    renderPrompt: text("render_prompt").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
)

export type CustomDashboard =
  typeof customDashboards.$inferSelect
export type NewCustomDashboard =
  typeof customDashboards.$inferInsert
