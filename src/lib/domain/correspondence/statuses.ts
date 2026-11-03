/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

/** Which side of the job a conversation participant is on. */
export const CORRESPONDENCE_PARTICIPANT_ROLES = ["staff", "owner", "sub_vendor"] as const

/** Where a correspondence message came from. */
export const CORRESPONDENCE_SOURCES = ["compass", "buildertrend", "email", "sms"] as const

export const CORRESPONDENCE_RECIPIENT_KINDS = ["author", "to", "cc"] as const

/** Recipient kinds on an imported source message (blind copies included). */
export const CORRESPONDENCE_SOURCE_RECIPIENT_KINDS = ["author", "to", "cc", "bcc"] as const

export const CORRESPONDENCE_REVISION_OPERATIONS = ["edit", "retract"] as const

export const PROJECT_EMAIL_CAMPAIGN_STATUSES = ["queued", "dispatching", "sent", "failed", "unknown"] as const

export const EMAIL_RECIPIENT_KINDS = ["to", "cc", "bcc"] as const
