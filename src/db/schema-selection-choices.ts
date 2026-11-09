/*
 * The rows under a finish selection: its choices, supplier product links,
 * photo links, comments, and the follow-up selections a choice opens.
 * Added by migrations 0311, 0312, 0313 (round alerts, the company
 * choice-template library) and 0314 (who picked, round signatures); the older flat `choice_options_json` on
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
  SELECTION_OVERAGE_TREATMENTS,
  SELECTION_ROUND_SIGNATURE_STATUSES,
} from "../lib/domain/selections/statuses"
import { projectChangeOrders } from "./schema-change-orders"
import { vendors } from "./schema-contacts"
import { dailyLogPhotos } from "./schema-field"
import { organizations, users } from "./schema-identity"
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
    // Who made the current pick, when, and why (e.g. staff "per phone call"); cleared with the pick (0314).
    chosenByUserId: text("chosen_by_user_id").references(() => users.id, { onDelete: "set null" }),
    chosenByAudience: text("chosen_by_audience", { enum: SELECTION_AUTHOR_AUDIENCES }),
    chosenAt: text("chosen_at"),
    chosenNote: text("chosen_note"),
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
    index("project_selection_choices_chosen_by_user_id_idx").on(table.chosenByUserId),
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

/**
 * "Round ready to finalize" was sent for this job and round. Staff are
 * alerted once; the row is removed when a pick is cleared, so the alert can
 * come again.
 */
export const projectSelectionRoundAlerts = sqliteTable(
  "project_selection_round_alerts",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    roundKey: text("round_key").notNull(),
    alertedAt: text("alerted_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.roundKey] })]
)

/** Company choice-template library: a named set of choices to apply to any job's selection. */
export const selectionChoiceTemplates = sqliteTable(
  "selection_choice_templates",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category"),
    description: text("description"),
    sourceSystem: text("source_system").notNull().default("compass"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("selection_choice_templates_org_name_unique").on(table.organizationId, table.name),
    index("selection_choice_templates_created_by_idx").on(table.createdBy),
  ]
)

export const selectionChoiceTemplateItems = sqliteTable(
  "selection_choice_template_items",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => selectionChoiceTemplates.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    priceCents: integer("price_cents"),
    ownerPriceCents: integer("owner_price_cents"),
    leadTimeDays: integer("lead_time_days"),
    vendorId: text("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    supplierName: text("supplier_name"),
    productUrl: text("product_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("selection_choice_template_items_template_idx").on(table.templateId, table.sortOrder),
    index("selection_choice_template_items_vendor_id_idx").on(table.vendorId),
  ]
)

/**
 * One owner signature request for a selections round (Foxit e-sign). The
 * signed document covers the items listed in
 * project_selection_round_signature_items; a round can be signed more than
 * once when picks change after signing.
 */
export const projectSelectionRoundSignatures = sqliteTable(
  "project_selection_round_signatures",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    roundKey: text("round_key").notNull(),
    // snapshot: the round's name when it was sent.
    roundNameSnapshot: text("round_name_snapshot").notNull(),
    status: text("status", { enum: SELECTION_ROUND_SIGNATURE_STATUSES }).notNull().default("preparing"),
    // json: snapshot of the signers it was sent to ({ name, email }[]).
    signersJsonSnapshot: text("signers_json_snapshot").notNull(),
    allowanceCents: integer("allowance_cents").notNull(),
    ownerTotalCents: integer("owner_total_cents").notNull(),
    deltaCents: integer("delta_cents").notNull(),
    treatment: text("treatment", { enum: SELECTION_OVERAGE_TREATMENTS }).notNull().default("none"),
    // The change order or variance for the over/under, signed in the same document.
    changeOrderId: text("change_order_id").references(() => projectChangeOrders.id, { onDelete: "set null" }),
    foxitEnvelopeId: text("foxit_envelope_id"),
    foxitEmbeddedSessionUrl: text("foxit_embedded_session_url"),
    sentAt: text("sent_at"),
    signedAt: text("signed_at"),
    // The signed PDF saved in the job's Drive folder.
    signedDriveFileId: text("signed_drive_file_id"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("project_selection_round_signatures_round_idx").on(table.projectId, table.roundKey),
    uniqueIndex("project_selection_round_signatures_envelope_unique")
      .on(table.foxitEnvelopeId)
      .where(sql`"foxit_envelope_id" IS NOT NULL`),
    index("project_selection_round_signatures_change_order_id_idx").on(table.changeOrderId),
    index("project_selection_round_signatures_created_by_idx").on(table.createdBy),
  ]
)

/** What one round signature covers: each selection with the pick and prices as signed. */
export const projectSelectionRoundSignatureItems = sqliteTable(
  "project_selection_round_signature_items",
  {
    signatureId: text("signature_id")
      .notNull()
      .references(() => projectSelectionRoundSignatures.id, { onDelete: "cascade" }),
    selectionId: text("selection_id")
      .notNull()
      .references(() => projectFinishSelections.id, { onDelete: "cascade" }),
    // The pick that was signed; a later different pick needs a new signature.
    choiceId: text("choice_id").references(() => projectSelectionChoices.id, { onDelete: "set null" }),
    // snapshot: the choice title, owner price and allowance as signed.
    choiceTitleSnapshot: text("choice_title_snapshot").notNull(),
    ownerPriceCentsSnapshot: integer("owner_price_cents_snapshot"),
    allowanceCentsSnapshot: integer("allowance_cents_snapshot"),
  },
  (table) => [
    primaryKey({ columns: [table.signatureId, table.selectionId] }),
    index("project_selection_round_signature_items_selection_idx").on(table.selectionId),
    index("project_selection_round_signature_items_choice_id_idx").on(table.choiceId),
  ]
)

export type ProjectSelectionChoice = typeof projectSelectionChoices.$inferSelect
export type ProjectSelectionLink = typeof projectSelectionLinks.$inferSelect
export type ProjectSelectionComment = typeof projectSelectionComments.$inferSelect
