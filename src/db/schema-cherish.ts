/*
 * The CHERISH board: pulse responses, story states and replies, and greeting
 * card requests with their physical card fulfillment.
 */

import {
  index,
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { organizations, users } from "./schema-identity"

export const cherishPulseResponses = sqliteTable("cherish_pulse_responses", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  submittedBy: text("submitted_by").references(() => users.id, {
    onDelete: "set null",
  }),
  submittedByName: text("submitted_by_name"),
  submittedByEmail: text("submitted_by_email"),
  isAnonymous: integer("is_anonymous", { mode: "boolean" })
    .notNull()
    .default(false),
  weekStart: text("week_start").notNull(),
  cherishValue: text("cherish_value").notNull(),
  responseType: text("response_type").notNull(),
  message: text("message").notNull(),
  source: text("source").notNull().default("compass_dashboard"),
  visibility: text("visibility").notNull().default("team"),
  audienceScope: text("audience_scope").notNull().default("company"),
  audienceReferenceId: text("audience_reference_id"),
  reviewStatus: text("review_status").notNull().default("needs_review"),
  reviewedBy: text("reviewed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedAt: text("reviewed_at"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
},
  (table) => [
    // Declared from drizzle/0039_cherish_pulse.sql.
    index("idx_cherish_pulse_org_week").on(table.organizationId, table.weekStart),
    // Declared from drizzle/0039_cherish_pulse.sql.
    index("idx_cherish_pulse_org_status").on(table.organizationId, table.reviewStatus),
    // Declared from drizzle/0039_cherish_pulse.sql.
    index("idx_cherish_pulse_org_visibility").on(table.organizationId, table.visibility),
    // Declared from drizzle/0039_cherish_pulse.sql.
    index("idx_cherish_pulse_submitted_by").on(table.submittedBy),
  ])

export const cherishCardFulfillments = sqliteTable(
  "cherish_card_fulfillments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    responseId: text("response_id")
      .notNull()
      .references(() => cherishPulseResponses.id),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull().default("handwrytten"),
    deliveryMethod: text("delivery_method").notNull().default("physical_mail"),
    providerOrderId: text("provider_order_id"),
    status: text("status").notNull().default("submitting"),
    providerCardId: text("provider_card_id").notNull(),
    cardName: text("card_name").notNull(),
    message: text("message").notNull(),
    wishes: text("wishes").notNull(),
    recipientFirstName: text("recipient_first_name").notNull(),
    recipientLastName: text("recipient_last_name").notNull(),
    recipientBusinessName: text("recipient_business_name"),
    recipientEmail: text("recipient_email"),
    recipientPhone: text("recipient_phone"),
    recipientAddress1: text("recipient_address1"),
    recipientAddress2: text("recipient_address2"),
    recipientCity: text("recipient_city"),
    recipientState: text("recipient_state"),
    recipientPostalCode: text("recipient_postal_code"),
    recipientCountry: text("recipient_country"),
    giftProviderItemId: text("gift_provider_item_id"),
    giftName: text("gift_name"),
    giftAmountCents: integer("gift_amount_cents"),
    providerError: text("provider_error"),
    submittedAt: text("submitted_at"),
    cancelledAt: text("cancelled_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("cherish_card_fulfillment_response_idx").on(table.responseId),
    index("cherish_card_fulfillment_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
  ],
)

export const greetingCardRequests = sqliteTable(
  "greeting_card_requests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedBy: text("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    rejectedBy: text("rejected_by").references(() => users.id, {
      onDelete: "set null",
    }),
    releasedBy: text("released_by").references(() => users.id, {
      onDelete: "set null",
    }),
    deletedBy: text("deleted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull().default("handwrytten"),
    deliveryMethod: text("delivery_method").notNull().default("physical_mail"),
    providerOrderId: text("provider_order_id"),
    status: text("status").notNull().default("pending_approval"),
    providerCardId: text("provider_card_id").notNull(),
    cardName: text("card_name").notNull(),
    cardPriceCents: integer("card_price_cents"),
    recipientType: text("recipient_type").notNull(),
    occasion: text("occasion"),
    message: text("message").notNull(),
    wishes: text("wishes").notNull(),
    recipientFirstName: text("recipient_first_name").notNull(),
    recipientLastName: text("recipient_last_name").notNull(),
    recipientBusinessName: text("recipient_business_name"),
    recipientAddress1: text("recipient_address1").notNull(),
    recipientAddress2: text("recipient_address2"),
    recipientCity: text("recipient_city").notNull(),
    recipientState: text("recipient_state").notNull(),
    recipientPostalCode: text("recipient_postal_code").notNull(),
    recipientCountry: text("recipient_country").notNull().default("United States"),
    recipientEmail: text("recipient_email"),
    giftProvider: text("gift_provider"),
    giftAmountCents: integer("gift_amount_cents"),
    giftRegion: text("gift_region"),
    giftCampaignUuid: text("gift_campaign_uuid"),
    giftRewardUuid: text("gift_reward_uuid"),
    giftClaimUrl: text("gift_claim_url"),
    giftStatus: text("gift_status"),
    giftExpiresOn: text("gift_expires_on"),
    publicToken: text("public_token"),
    emailProvider: text("email_provider"),
    emailProviderMessageId: text("email_provider_message_id"),
    openedAt: text("opened_at"),
    approvalNote: text("approval_note"),
    providerError: text("provider_error"),
    approvedAt: text("approved_at"),
    rejectedAt: text("rejected_at"),
    releasedAt: text("released_at"),
    submittedAt: text("submitted_at"),
    cancelledAt: text("cancelled_at"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("greeting_card_requests_org_status_created_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    index("greeting_card_requests_requester_created_idx").on(
      table.requestedBy,
      table.createdAt,
    ),
    uniqueIndex("greeting_card_requests_public_token_idx").on(table.publicToken),
  ],
)

export const cherishPulseStoryStates = sqliteTable(
  "cherish_pulse_story_states",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    responseId: text("response_id")
      .notNull()
      .references(() => cherishPulseResponses.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    viewedAt: text("viewed_at").notNull(),
    reactedAt: text("reacted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("cherish_story_state_response_user_idx").on(
      table.responseId,
      table.userId,
    ),
    index("cherish_story_state_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
    index("cherish_pulse_story_states_user_id_idx").on(table.userId),
  ],
)

export const cherishPulseStoryReplies = sqliteTable(
  "cherish_pulse_story_replies",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    responseId: text("response_id")
      .notNull()
      .references(() => cherishPulseResponses.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: text("recipient_id").references(() => users.id, {
      onDelete: "set null",
    }),
    message: text("message").notNull(),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("cherish_story_reply_response_created_idx").on(
      table.responseId,
      table.createdAt,
    ),
    index("cherish_story_reply_recipient_created_idx").on(
      table.recipientId,
      table.createdAt,
    ),
    index("cherish_pulse_story_replies_organization_id_idx").on(table.organizationId),
  ],
)
