import { z } from "zod/v4"

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

const sageClientFieldsSchema = z.object({
  compassCustomerId: z.string().min(1),
  sageClientId: z.string().min(1).nullable().optional(),
  sageClientNumber: z.string().min(1).nullable().optional(),
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

const linkedClientRule = {
  check: (client: { readonly sageClientId?: string | null; readonly sageClientNumber?: string | null }): boolean =>
    Boolean(client.sageClientId) === Boolean(client.sageClientNumber),
  message: { message: "A linked Sage client needs both its stable ID and number", path: ["sageClientId"] },
}

const sageClientPayloadSchema = sageClientFieldsSchema.refine(linkedClientRule.check, linkedClientRule.message)

const sageJobPayloadSchema = z.object({
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
    // Gives an existing Sage job its missing client; the writer never adds a job here.
    z.object({
      operationType: z.literal("set_job_client"),
      company: z.literal("High Performance Structures Inc"),
      client: sageClientFieldsSchema.extend({
        compassCustomerId: z.string().min(1).nullable(),
        contactName: z.string().max(50).nullable(),
      }).refine(linkedClientRule.check, linkedClientRule.message),
      job: z.object({
        compassProjectId: z.string().min(1).nullable(),
        sageJobId: z.string().min(1),
        sageJobNumber: z.string().min(1),
        name: z.string().min(1).max(75),
      }),
    }),
    z.object({
      operationType: z.literal("update_client_email"),
      company: z.literal("High Performance Structures Inc"),
      client: z.object({
        compassCustomerId: z.string().min(1),
        sageClientId: z.string().min(1),
        sageClientNumber: z.string().min(1),
        email: z.string().email().max(75),
      }),
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
      // Jobs carried over from NetSuite have no job type (0).
      typeNumber: z.number().int().nonnegative(),
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

export function sageJobName(
  projectNumber: string | null,
  projectName: string
): string {
  const normalizedName = projectName.trim().replace(/\s+/g, " ")
  const normalizedNumber = projectNumber?.trim().replace(/\s+/g, " ") ?? ""
  const fullName = normalizedNumber
    ? `${normalizedNumber}-${normalizedName}`
    : normalizedName
  return fullName.slice(0, 75)
}

export function sageClientProjectWritesEnabled(env: CloudflareEnv): boolean {
  const value: unknown = Reflect.get(env, "SAGE_CLIENT_PROJECT_WRITES_ENABLED")
  return typeof value === "string" && value.trim().toLowerCase() === "true"
}
