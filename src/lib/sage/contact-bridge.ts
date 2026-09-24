import { z } from "zod/v4"

import {
  sageContactProposalFields,
  type SageContactFieldChange,
  type SageContactKind,
} from "@/lib/sage/contact-change-proposal"

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
