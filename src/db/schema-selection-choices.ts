/*
 * The rows under a finish selection: its choices, supplier product links,
 * photo links, comments, and the follow-up selections a choice opens.
 * Added by migrations 0311 and 0312; the older flat `choice_options_json` on
 * project_finish_selections is kept and backfilled into choice rows.
 * Written by: src/lib/domain/selections/choices-store.ts.
 */

import { sql } from "drizzle-orm"
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import {
  SELECTION_AUTHOR_AUDIENCES,
  SELECTION_CHOICE_STATUSES,
  SELECTION_COMMENT_VISIBILITIES,
} from "../lib/domain/selections/statuses"
import { vendors } from "./schema-contacts"
import { dailyLogPhotos } from "./schema-field"
import { users } from "./schema-identity"
import { projects } from "./schema-projects"
import { projectFinishSelections } from "./schema-selections"

export const projectSelectionChoices = sqliteTable(
  "project_selection_choices",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    selectionId: text("selection_id")
      .notNull()
      .references(() => projectFinishSelections.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    // The supplier's price; staff only.
    priceCents: integer("price_cents"),
    // What the owner sees (supplier price plus builder fee), set by staff (migration 0312).
    ownerPriceCents: integer("owner_price_cents"),
    leadTimeDays: integer("lead_time_days"),
    vendorId: text("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    // Free-text supplier for a supplier that is not (yet) a vendor record.
    supplierName: text("supplier_name"),
    sortOrder: integer("sort_order").notNull().default(0),
    chosen: integer("chosen", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: SELECTION_CHOICE_STATUSES }).notNull().default("proposed"),
    sourceSystem: text("source_system").notNull().default("compass"),
    btChoiceId: text("bt_choice_id"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("project_selection_choices_selection_idx").on(table.selectionId, table.sortOrder),
    index("project_selection_choices_project_idx").on(table.projectId),
    index("project_selection_choices_vendor_id_idx").on(table.vendorId),
    index("project_selection_choices_created_by_idx").on(table.createdBy),
    // At most one chosen choice per selection.
    uniqueIndex("project_selection_choices_one_chosen")
      .on(table.selectionId)
      .where(sql`"chosen" = 1`),
    // A Buildertrend choice is imported once.
    uniqueIndex("project_selection_choices_bt_unique")
      .on(table.sourceSystem, table.btChoiceId)
      .where(sql`"bt_choice_id" IS NOT NULL`),
  ]
)

/** A supplier product page on a selection or one of its choices, with the preview read from the page. */
export const projectSelectionLinks = sqliteTable(
  "project_selection_links",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    selectionId: text("selection_id")
      .notNull()
      .references(() => projectFinishSelections.id, { onDelete: "cascade" }),
    choiceId: text("choice_id").references(() => projectSelectionChoices.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    // Preview card read from the page (og:title / og:image / price); null when the page gave none.
    title: text("title"),
    imageUrl: text("image_url"),
    priceCents: integer("price_cents"),
    siteName: text("site_name"),
    fetchedAt: text("fetched_at"),
    addedByUserId: text("added_by_user_id").references(() => users.id, { onDelete: "set null" }),
    addedByAudience: text("added_by_audience", { enum: SELECTION_AUTHOR_AUDIENCES }).notNull().default("staff"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("project_selection_links_selection_idx").on(table.selectionId),
    index("project_selection_links_project_idx").on(table.projectId),
    index("project_selection_links_choice_id_idx").on(table.choiceId),
    index("project_selection_links_added_by_user_id_idx").on(table.addedByUserId),
  ]
)

/** A project photo shown on a selection, or on one choice of it. A photo links once per selection. */
export const projectSelectionPhotos = sqliteTable(
  "project_selection_photos",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    selectionId: text("selection_id")
      .notNull()
      .references(() => projectFinishSelections.id, { onDelete: "cascade" }),
    choiceId: text("choice_id").references(() => projectSelectionChoices.id, { onDelete: "cascade" }),
    photoId: text("photo_id")
      .notNull()
      .references(() => dailyLogPhotos.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    addedBy: text("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_selection_photos_unique").on(table.selectionId, table.photoId),
    index("project_selection_photos_project_idx").on(table.projectId),
    index("project_selection_photos_choice_id_idx").on(table.choiceId),
    index("project_selection_photos_photo_id_idx").on(table.photoId),
    index("project_selection_photos_added_by_idx").on(table.addedBy),
  ]
)

export const projectSelectionComments = sqliteTable(
  "project_selection_comments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    selectionId: text("selection_id")
      .notNull()
      .references(() => projectFinishSelections.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    visibility: text("visibility", { enum: SELECTION_COMMENT_VISIBILITIES }).notNull().default("staff"),
    authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorAudience: text("author_audience", { enum: SELECTION_AUTHOR_AUDIENCES }).notNull().default("staff"),
    // snapshot: the author's name as the source showed it, for imported comments with no Compass user.
    authorNameSnapshot: text("author_name_snapshot"),
    sourceSystem: text("source_system").notNull().default("compass"),
    btCommentId: text("bt_comment_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("project_selection_comments_selection_idx").on(table.selectionId, table.createdAt),
    index("project_selection_comments_project_idx").on(table.projectId),
    index("project_selection_comments_author_user_id_idx").on(table.authorUserId),
    uniqueIndex("project_selection_comments_bt_unique")
      .on(table.sourceSystem, table.btCommentId)
      .where(sql`"bt_comment_id" IS NOT NULL`),
  ]
)

/** A choice that opens follow-up selections (a vanity opens its hardware). */
export const projectSelectionChoiceDependents = sqliteTable(
  "project_selection_choice_dependents",
  {
    choiceId: text("choice_id")
      .notNull()
      .references(() => projectSelectionChoices.id, { onDelete: "cascade" }),
    selectionId: text("selection_id")
      .notNull()
      .references(() => projectFinishSelections.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.choiceId, table.selectionId] }),
    index("project_selection_choice_dependents_selection_idx").on(table.selectionId),
  ]
)

export type ProjectSelectionChoice = typeof projectSelectionChoices.$inferSelect
export type ProjectSelectionLink = typeof projectSelectionLinks.$inferSelect
export type ProjectSelectionComment = typeof projectSelectionComments.$inferSelect
