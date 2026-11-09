import "server-only"

import { eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { jobEmailDeliverySettings } from "@/db/schema-job-workflows"

export type JobEmailDeliveryView = {
  readonly insuranceAgentEmail: string | null
  readonly w9Version: string | null
  readonly w9Filename: string | null
}

/** Only return configuration and file metadata to the settings editor and composer. */
export async function readJobEmailDeliverySettings(
  db: ReturnType<typeof getDb>,
  organizationId: string,
): Promise<JobEmailDeliveryView> {
  const settings = await db.select({
    insuranceAgentEmail: jobEmailDeliverySettings.insuranceAgentEmail,
    w9Version: jobEmailDeliverySettings.w9Version,
    w9Filename: jobEmailDeliverySettings.w9Filename,
  }).from(jobEmailDeliverySettings).where(eq(jobEmailDeliverySettings.organizationId, organizationId)).get()
  return settings ?? { insuranceAgentEmail: null, w9Version: null, w9Filename: null }
}
