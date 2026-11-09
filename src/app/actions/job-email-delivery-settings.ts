"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { jobEmailDeliverySettings } from "@/db/schema-job-workflows"
import { recordActivityEvent } from "@/lib/activity-log"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { isValidRecipientEmail, normalizeRecipientEmail } from "@/lib/email/recipient-options"
import { canEditFeatureSettings } from "@/lib/feature-settings/registry"
import { MAX_W9_BYTES } from "@/lib/job-workflows/email-delivery"
import { readJobEmailDeliverySettings, type JobEmailDeliveryView } from "@/lib/job-workflows/email-delivery-server"
import { requireOrg } from "@/lib/org-scope"
import { requireUserContext } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

async function settingsContext(edit: boolean) {
  const { user, db } = await requireUserContext()
  const organizationId = requireOrg(user)
  if (!user.isActive || !isInternalStaffRole(user.role)) throw new Error("Job email settings are available to office staff.")
  if (edit && (!canEditFeatureSettings(user.role, "job-emails") || isDemoUser(user.id) || isDemoOrg(organizationId))) {
    throw new Error("Only company admins can change job email settings.")
  }
  return { db, user, organizationId }
}

export async function getJobEmailDeliverySettings(): Promise<Result<JobEmailDeliveryView>> {
  try {
    const { db, organizationId } = await settingsContext(false)
    return { success: true, data: await readJobEmailDeliverySettings(db, organizationId) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to load job email settings." }
  }
}

export async function saveJobEmailDeliverySettings(formData: FormData): Promise<Result<JobEmailDeliveryView>> {
  try {
    const { db, organizationId, user } = await settingsContext(true)
    const address = formData.get("insuranceAgentEmail")
    if (typeof address !== "string") return { success: false, error: "Enter an insurance agent email address or leave it blank." }
    const insuranceAgentEmail = normalizeRecipientEmail(address) || null
    if (insuranceAgentEmail && !isValidRecipientEmail(insuranceAgentEmail)) {
      return { success: false, error: "Enter a valid insurance agent email address." }
    }

    const file = formData.get("w9")
    const upload = file instanceof File && (file.size > 0 || file.name !== "") ? file : null
    let w9 = null
    if (upload) {
      if (upload.size > MAX_W9_BYTES) return { success: false, error: "The W-9 PDF must be 1 MB or smaller." }
      const bytes = Buffer.from(await upload.arrayBuffer())
      if (!upload.name.toLowerCase().endsWith(".pdf") || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
        return { success: false, error: "Upload the W-9 as a PDF." }
      }
      w9 = {
        w9Version: crypto.randomUUID(),
        w9Filename: upload.name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, -4).slice(0, 120) + ".pdf",
        w9Pdf: bytes,
      }
    }

    const values = { insuranceAgentEmail, ...w9 }
    await db.insert(jobEmailDeliverySettings).values({ organizationId, ...values }).onConflictDoUpdate({
      target: jobEmailDeliverySettings.organizationId,
      set: values,
    })
    if (w9) {
      await recordActivityEvent({
        db, organizationId, actor: user, category: "settings", action: "job_email_w9_uploaded",
        entityType: "job_email_delivery_settings", entityId: organizationId, summary: "Uploaded the company W-9 for job emails.",
      })
    }
    revalidatePath("/dashboard/settings")
    return { success: true, data: await readJobEmailDeliverySettings(db, organizationId) }
  } catch {
    // Database errors may include the uploaded PDF in the bound parameters.
    console.error("Unable to save job email delivery settings")
    return { success: false, error: "Unable to save job email delivery settings." }
  }
}

export async function removeJobEmailW9(version: string): Promise<Result<JobEmailDeliveryView>> {
  try {
    const { db, organizationId, user } = await settingsContext(true)
    const [removed] = await db.update(jobEmailDeliverySettings)
      .set({ w9Version: null, w9Filename: null, w9Pdf: null })
      .where(and(eq(jobEmailDeliverySettings.organizationId, organizationId), eq(jobEmailDeliverySettings.w9Version, version)))
      .returning({ organizationId: jobEmailDeliverySettings.organizationId })
    if (!removed) return { success: false, error: "The W-9 changed. Reload Settings and try again." }
    await recordActivityEvent({
      db, organizationId, actor: user, category: "settings", action: "job_email_w9_removed",
      entityType: "job_email_delivery_settings", entityId: organizationId, summary: "Removed the company W-9 from job emails.",
    })
    revalidatePath("/dashboard/settings")
    return { success: true, data: await readJobEmailDeliverySettings(db, organizationId) }
  } catch (error) {
    console.error("Unable to remove job email W-9", error)
    return { success: false, error: "Unable to remove the company W-9." }
  }
}
