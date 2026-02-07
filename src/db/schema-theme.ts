import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { users } from "./schema"

export const customThemes = sqliteTable("custom_themes", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  themeData: text("theme_data").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const userThemePreference = sqliteTable(
  "user_theme_preference",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    activeThemeId: text("active_theme_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
)

export type CustomTheme = typeof customThemes.$inferSelect
export type NewCustomTheme = typeof customThemes.$inferInsert
export type UserThemePreference =
  typeof userThemePreference.$inferSelect
