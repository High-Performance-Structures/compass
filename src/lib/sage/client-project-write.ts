import { and, eq } from "drizzle-orm"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { sageWriteApprovals } from "@/db/schema-sage"

export const SAGE_CLIENT_STATUS_OPTIONS = [
  { id: 1, name: "Current" },
  { id: 2, name: "Warranty" },
  { id: 3, name: "Complete" },
  { id: 4, name: "Inactive" },
  { id: 5, name: "Archive" },
  { id: 6, name: "Other" },
] as const

export const SAGE_JOB_TYPE_OPTIONS = [
  { id: "customer", name: "Customer" },
  { id: "internal", name: "Internal" },
] as const

export type SageClientStatusId =
  (typeof SAGE_CLIENT_STATUS_OPTIONS)[number]["id"]
export type SageJobTypeId = (typeof SAGE_JOB_TYPE_OPTIONS)[number]["id"]

export const sageClientPayloadSchema = z.object({
  compassCustomerId: z.string().min(1),
  name: z.string().min(1).max(75),
  shortName: z.string().min(1).max(30),
  company: z.string().max(75).nullable(),
  email: z.string().max(75).nullable(),
  phone: z.string().max(50).nullable(),
  address: z.string().max(500).nullable(),
  billingAddress: z.string().max(500).nullable(),
  notes: z.string().max(4000).nullable(),
  status: z.object({
    expectedNumber: z.number().int().min(1).max(6),
    name: z.string().min(1).max(50),
  }),
})

export const sageJobPayloadSchema = z.object({
  compassProjectId: z.string().min(1),
  compassProjectNumber: z.string().min(1).max(30).nullable(),
  name: z.string().min(1).max(75),
  shortName: z.string().min(1).max(30),
  address: z.string().max(500).nullable(),
  statusName: z.string().min(1).max(50),
  typeName: z.string().min(1).max(50),
})

export const sageClientProjectWritePayloadSchema = z.discriminatedUnion(
  "operationType",
  [
    z.object({
      operationType: z.literal("ensure_client"),
      company: z.literal("High Performance Structures Inc"),
      client: sageClientPayloadSchema,
    }),
    z.object({
      operationType: z.literal("ensure_client_and_job"),
      company: z.literal("High Performance Structures Inc"),
      client: sageClientPayloadSchema,
      job: sageJobPayloadSchema,
    }),
  ]
)

const sageWriteSuccessSchema = z.object({
  operationId: z.string().min(1),
  claimToken: z.string().uuid(),
  outcome: z.literal("succeeded"),
  client: z.object({
    id: z.string().min(1),
    number: z.string().min(1),
    statusNumber: z.number().int().positive(),
  }),
  job: z
    .object({
      id: z.string().min(1),
      number: z.string().min(1),
      statusNumber: z.number().int().positive(),
      typeNumber: z.number().int().positive(),
    })
    .nullable(),
})

const sageWriteFailureSchema = z.object({
  operationId: z.string().min(1),
  claimToken: z.string().uuid(),
  outcome: z.literal("failed"),
  error: z.string().min(1).max(4000),
})

export const sageClientProjectWriteResultSchema = z.discriminatedUnion(
  "outcome",
  [sageWriteSuccessSchema, sageWriteFailureSchema]
)

export function parseSageClientStatusId(value: unknown): SageClientStatusId | null {
  const parsed = typeof value === "number" ? value : Number(value)
  const match = SAGE_CLIENT_STATUS_OPTIONS.find((option) => option.id === parsed)
  return match?.id ?? null
}

export function parseSageJobTypeId(value: unknown): SageJobTypeId | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  const match = SAGE_JOB_TYPE_OPTIONS.find((option) => option.id === normalized)
  return match?.id ?? null
}

export function sageClientStatusName(id: SageClientStatusId): string {
  const match = SAGE_CLIENT_STATUS_OPTIONS.find((option) => option.id === id)
  return match?.name ?? "Other"
}

export function sageJobTypeName(id: SageJobTypeId): string {
  const match = SAGE_JOB_TYPE_OPTIONS.find((option) => option.id === id)
  return match?.name ?? "Customer"
}

export function sageShortName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 30)
}

export async function isSageWriteApproved(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  userId: string
): Promise<boolean> {
  const row = await db
    .select({ id: sageWriteApprovals.id })
    .from(sageWriteApprovals)
    .where(
      and(
        eq(sageWriteApprovals.organizationId, organizationId),
        eq(sageWriteApprovals.userId, userId)
      )
    )
    .limit(1)
  return Boolean(row[0])
}

export function sageClientProjectWritesEnabled(env: CloudflareEnv): boolean {
  const value: unknown = Reflect.get(env, "SAGE_CLIENT_PROJECT_WRITES_ENABLED")
  return typeof value === "string" && value.trim().toLowerCase() === "true"
}
