import { z } from "zod/v4"

import {
  sageContactProposalFields,
  type SageContactCreateFields,
  type SageContactFieldChange,
  type SageContactKind,
} from "@/lib/sage/contact-change-proposal"
import type { SageContactEntityIdentity } from "@/lib/sage/contact-entity"

export function sageContactIdentityError(
  identity: SageContactEntityIdentity,
  snapshot: {
    readonly sageRecordId: string
    readonly sageRecordNumber: string | null
    readonly parentSageRecordId: string | null
  }
): string | null {
  // A number-only import is a candidate, not a reviewed directory link.
  if (!identity.sageRecordId) {
    return "Review and link the stable Sage record ID before synchronizing this contact."
  }
  if (identity.sageRecordId !== snapshot.sageRecordId) {
    return "Sage record ID does not match the directory link."
  }
  if (identity.sageRecordNumber && identity.sageRecordNumber !== snapshot.sageRecordNumber) {
    return "Sage record number does not match the directory link."
  }
  if (identity.parentSageRecordId !== snapshot.parentSageRecordId) {
    return "Sage parent company does not match the directory link."
  }
  return null
}

export const sageContactKindSchema = z.enum([
  "client_company", "client_person", "vendor_company", "vendor_person", "employee",
])

export function sageContactOrganizationMatches(env: object, organizationId: string): boolean {
  const configured: unknown = Reflect.get(env, "SAGE_CONTACT_ORGANIZATION_ID")
  return typeof configured === "string" && configured.trim().length > 0 &&
    configured.trim() === organizationId
}

export const sageContactFieldsSchema = z.record(z.string(), z.string().nullable())

export const sageContactSnapshotResultSchema = z.object({
  kind: sageContactKindSchema,
  entityId: z.string().min(1),
  sageRecordId: z.string().min(1),
  sageRecordNumber: z.string().nullable(),
  parentSageRecordId: z.string().nullable(),
  revision: z.string().min(1).max(128),
  fields: sageContactFieldsSchema,
})

const bridgeFailureSchema = z.object({
  outcome: z.literal("failed"),
  id: z.string().uuid(),
  claimToken: z.string().uuid(),
  error: z.string().min(1).max(1000),
})

export const sageContactReadResultSchema = z.discriminatedUnion("outcome", [
  bridgeFailureSchema,
  z.object({
    outcome: z.literal("succeeded"),
    id: z.string().uuid(),
    claimToken: z.string().uuid(),
    snapshot: sageContactSnapshotResultSchema,
  }),
])

export const sageContactWriteResultSchema = z.discriminatedUnion("outcome", [
  bridgeFailureSchema,
  z.object({
    outcome: z.literal("succeeded"),
    id: z.string().uuid(),
    claimToken: z.string().uuid(),
    snapshot: sageContactSnapshotResultSchema,
  }),
])

export const sageContactCreateResultSchema = z.discriminatedUnion("outcome", [
  bridgeFailureSchema.extend({ attempted: z.boolean() }),
  z.object({
    outcome: z.literal("succeeded"),
    id: z.string().uuid(),
    claimToken: z.string().uuid(),
    snapshot: sageContactSnapshotResultSchema,
  }),
])

export function readbackConfirmsCreateFields(
  proposed: SageContactCreateFields,
  readback: Readonly<Record<string, string | null>>
): boolean {
  return Object.entries(proposed).every(([field, value]) =>
    Object.prototype.hasOwnProperty.call(readback, field) &&
    (readback[field]?.trim() || null) === value
  )
}

export function hasOnlySageContactFields(
  kind: SageContactKind,
  fields: Readonly<Record<string, string | null>>
): boolean {
  const allowed = sageContactProposalFields(kind)
  return Object.keys(fields).length > 0 && Object.keys(fields).every((field) =>
    allowed.some((known) => known === field)
  )
}

export function readbackConfirmsChanges(
  changes: readonly SageContactFieldChange[],
  fields: Readonly<Record<string, string | null>>
): boolean {
  return changes.every((change) =>
    Object.prototype.hasOwnProperty.call(fields, change.field) &&
    (fields[change.field]?.trim() || null) === change.after
  )
}
