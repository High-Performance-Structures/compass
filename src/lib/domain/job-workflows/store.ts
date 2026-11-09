import "server-only"

import { and, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { jobEmailDeliverySettings } from "@/db/schema-job-workflows"

type Db = ReturnType<typeof getDb>

export type JobEmailDeliveryView = {
  readonly insuranceAgentEmail: string | null
  readonly w9Version: string | null
  readonly w9Filename: string | null
}

/** Only return configuration and file metadata to the settings editor and composer. */
export async function readJobEmailDeliverySettings(
  db: Db,
  organizationId: string,
): Promise<JobEmailDeliveryView> {
  const settings = await db.select({
    insuranceAgentEmail: jobEmailDeliverySettings.insuranceAgentEmail,
    w9Version: jobEmailDeliverySettings.w9Version,
    w9Filename: jobEmailDeliverySettings.w9Filename,
  }).from(jobEmailDeliverySettings).where(eq(jobEmailDeliverySettings.organizationId, organizationId)).get()
  return settings ?? { insuranceAgentEmail: null, w9Version: null, w9Filename: null }
}

type W9Upload = {
  readonly w9Version: string
  readonly w9Filename: string
  readonly w9Pdf: Buffer
}

export async function writeJobEmailDeliverySettings(
  db: Db,
  organizationId: string,
  insuranceAgentEmail: string | null,
  w9: W9Upload | null,
): Promise<void> {
  const values = { insuranceAgentEmail, ...w9 }
  await db.insert(jobEmailDeliverySettings).values({ organizationId, ...values }).onConflictDoUpdate({
    target: jobEmailDeliverySettings.organizationId,
    set: values,
  })
}

export async function clearJobEmailW9(db: Db, organizationId: string, version: string): Promise<boolean> {
  const [removed] = await db.update(jobEmailDeliverySettings)
    .set({ w9Version: null, w9Filename: null, w9Pdf: null })
    .where(and(eq(jobEmailDeliverySettings.organizationId, organizationId), eq(jobEmailDeliverySettings.w9Version, version)))
    .returning({ organizationId: jobEmailDeliverySettings.organizationId })
  return Boolean(removed)
}

export async function readJobEmailW9(
  db: Db,
  organizationId: string,
  version: string,
): Promise<{ readonly filename: string; readonly pdf: Buffer } | null> {
  const w9 = await db.select({ filename: jobEmailDeliverySettings.w9Filename, pdf: jobEmailDeliverySettings.w9Pdf })
    .from(jobEmailDeliverySettings)
    .where(and(eq(jobEmailDeliverySettings.organizationId, organizationId), eq(jobEmailDeliverySettings.w9Version, version)))
    .get()
  return w9?.filename && w9.pdf?.length ? { filename: w9.filename, pdf: w9.pdf } : null
}
