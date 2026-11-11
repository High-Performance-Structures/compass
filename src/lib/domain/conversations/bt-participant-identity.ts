import { createHash } from "node:crypto"

/*
 * Who an imported Buildertrend message participant is: the pure keys and ids
 * the retired Buildertrend message importer stored, kept so staff review and
 * the automatic pass on Contacts → Needs review find and reuse the same rows.
 * No database access here; project contacts are written only through
 * src/lib/domain/contacts/store.ts. The importer scripts themselves were
 * retired 2026-11-10 once the Buildertrend cutover finished.
 */

/** A trimmed, lowercased email, or null. */
function normalizeEmail(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().toLowerCase() : null
}

/** A whitespace-collapsed, lowercased name, or null. */
function normalizeName(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().replace(/\s+/g, " ").toLowerCase() : null
}

// Deterministic ids: the same inputs always give the same id, so the rows the
// importer created are found again instead of copied.
function shortId(prefix: string, ...parts: readonly string[]): string {
  return `${prefix}-${createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 32)}`
}

type ParticipantRef = {
  readonly namespace: string
  readonly participantId: string | null
  readonly email: string | null
  readonly displayName: string | null
}

/** The exact source key of a participant: its id, else its email, else its name. */
export function participantKey(participant: ParticipantRef): string {
  if (participant.participantId) return `${participant.namespace}:${participant.participantId}`
  const email = normalizeEmail(participant.email)
  if (email) return `${participant.namespace}:email:${email}`
  return `${participant.namespace}:name:${normalizeName(participant.displayName) ?? "unknown"}`
}

/** The vendor person id for a new person connected to a vendor, keyed by their identity (`new:email:…`). */
export function importedVendorContactId(organizationId: string, identity: string): string {
  return shortId("bt-vendor-contact", organizationId, identity)
}

/** The project contact id for an imported person on a project, keyed by their identity. */
export function importedContactId(projectId: string, identity: string): string {
  return shortId("bt-contact", projectId, identity)
}

/** Looks like one whole person: an exact email, or a name of two or more words. */
export function isFullPersonText(value: unknown): boolean {
  const textValue = typeof value === "string" ? value.trim() : ""
  if (textValue.includes("@") && !/\s/.test(textValue)) return normalizeEmail(textValue) !== null
  return textValue.split(/\s+/).filter(Boolean).length >= 2 && !/[,;]/.test(textValue)
}

export type ImportedParticipantKind = "owner" | "vendor" | "former_staff"

/** How an imported participant is recorded as a project contact (contact type and source). */
export type ImportedContactSource = {
  readonly contactType: "owner" | "subcontractor" | "internal"
  readonly sourceEntityType: "buildertrend_participant" | "buildertrend_former_employee"
  readonly sourceEntityId: string
  /** A former employee is archived: never listed, only named on messages. */
  readonly active: boolean
}

const CONTACT_TYPE_FOR_KIND: Readonly<Record<ImportedParticipantKind, ImportedContactSource["contactType"]>> = {
  owner: "owner",
  vendor: "subcontractor",
  former_staff: "internal",
}

/**
 * The source fields of the project contact for a participant new to the
 * project, matching what the importer recorded. Former employees are keyed by
 * their identity, so one person is one row per project however pages named them.
 */
export function importedContactSource(input: { readonly kind: ImportedParticipantKind; readonly key: string; readonly identity: string }): ImportedContactSource {
  const formerStaff = input.kind === "former_staff"
  return {
    contactType: CONTACT_TYPE_FOR_KIND[input.kind],
    sourceEntityType: formerStaff ? "buildertrend_former_employee" : "buildertrend_participant",
    sourceEntityId: formerStaff ? input.identity : input.key,
    active: !formerStaff,
  }
}
