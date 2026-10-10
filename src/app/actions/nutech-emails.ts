"use server"

import { and, asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { projectContacts, projectInteractions, projectOperations, projectProfileAuditEvents, projects } from "@/db/schema"
import { nuTechOrderWorkflows } from "@/db/schema-nutech"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { sendCompassEmail } from "@/lib/email/compass-email"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import {
  NUTECH_EMAIL_TEMPLATES,
  nuTechTemplateText,
  renderNuTechEmail,
  type NuTechEmailAudience,
  type NuTechEmailContext,
  type NuTechEmailTemplate,
} from "@/lib/nutech/email-templates"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { projectDepartment } from "@/lib/project-branding"
import { isInternalStaffRole } from "@/lib/user-roles"

export type NuTechEmailDraft = {
  readonly templateId: string
  readonly label: string
  readonly audience: NuTechEmailAudience
  readonly senderAddress: string
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly subject: string
  readonly body: string
  /** Merge fields that were empty, to fill in before sending. */
  readonly missing: readonly string[]
}

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function formatDate(value: string | null): string {
  if (!value) return ""
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
}

function splitName(name: string): { readonly first: string; readonly last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return { first: parts[0] ?? "", last: parts.length > 1 ? (parts[parts.length - 1] ?? "") : "" }
}

function templateById(id: string): NuTechEmailTemplate | null {
  return NUTECH_EMAIL_TEMPLATES.find((template) => template.id === id) ?? null
}

async function nuTechEmailContext(projectId: string, action: "read" | "update") {
  const user = await requireAuth()
  if (!isInternalStaffRole(user.role)) throw new Error("Nu-Tech emails are available to office staff.")
  await requireFeaturePermission(user, "nutech-orders", action)
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      address: projects.address,
      clientName: projects.clientName,
      deliveryMethod: projects.deliveryMethod,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
    .get()
  if (!project) throw new Error("Project not found.")
  if (projectDepartment({ projectId: project.id, projectNumber: project.projectNumber }) !== "N") {
    throw new Error("Nu-Tech emails are available only for N projects.")
  }
  const [settings, contacts, order] = await Promise.all([
    readFeatureSettings(db, organizationId, "nutech-emails"),
    db
      .select({ id: projectContacts.id, displayName: projectContacts.displayName, email: projectContacts.email })
      .from(projectContacts)
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.contactType, "owner"), eq(projectContacts.active, true)))
      .orderBy(asc(projectContacts.displayName)),
    db.select().from(nuTechOrderWorkflows).where(eq(nuTechOrderWorkflows.projectId, projectId)).limit(1).get(),
  ])
  const purchaseOrder = order?.airlitePurchaseOrderOperationId
    ? await db
        .select({ number: projectOperations.sourceRecordNumber })
        .from(projectOperations)
        .where(eq(projectOperations.id, order.airlitePurchaseOrderOperationId))
        .limit(1)
        .get()
    : undefined
  const customer = contacts[0] ?? null
  const customerName = customer?.displayName ?? project.clientName ?? ""
  const name = splitName(customerName)
  const fulfillment: "delivery" | "pickup" | null = order
    ? order.deliveryMethod === "delivery"
      ? "delivery"
      : "pickup"
    : project.deliveryMethod === "delivery" || project.deliveryMethod === "pickup"
      ? project.deliveryMethod
      : null
  const context: NuTechEmailContext = {
    customerFirstName: name.first,
    customerName,
    customerLastName: name.last || name.first,
    projectNumber: project.projectNumber ?? "",
    jobAddress: project.address ?? "",
    poNumber: purchaseOrder?.number ?? "",
    epsNumber: order?.vendorConfirmationNumber ?? "",
    requestedDate: formatDate(order?.requestedDeliveryDate ?? null),
    trailerDimensions: order?.trailerDimensions ?? "",
    quantitySummary: order?.blockQuantityNotes ?? "",
    pricingLabel: order?.pricingMode === "cash_discount" ? "cash-discounted pricing" : "standard pricing",
    senderName: user.displayName ?? user.email,
    officePhone: settings.officePhone,
    officeHours: settings.officeHours,
    dealerAccountNumber: settings.dealerAccountNumber,
    warehouseName: settings.warehouseName,
    warehouseAddress: settings.warehouseAddress,
    warehousePhone: settings.warehousePhone,
    warehouseEmail: settings.warehouseEmail,
    warehouseDockHours: settings.warehouseDockHours,
  }
  return { user, organizationId, env, db, project, settings, customer, context, fulfillment }
}

function defaultRecipients(
  audience: NuTechEmailAudience,
  customerEmail: string | null,
  settings: { readonly manufacturerOrdersEmail: string; readonly manufacturerCcEmail: string; readonly warehouseEmail: string },
): { readonly to: readonly string[]; readonly cc: readonly string[] } {
  switch (audience) {
    case "customer":
      return { to: customerEmail ? [customerEmail] : [], cc: [] }
    case "manufacturer":
      return {
        to: settings.manufacturerOrdersEmail ? [settings.manufacturerOrdersEmail] : [],
        cc: settings.manufacturerCcEmail ? [settings.manufacturerCcEmail] : [],
      }
    case "warehouse":
      return { to: settings.warehouseEmail ? [settings.warehouseEmail] : [], cc: [] }
    case "carrier":
      return { to: [], cc: [] }
  }
}

/** A template filled in for this job, ready to review in the composer. */
export async function getNuTechEmailDraft(projectId: string, templateId: string): Promise<Result<NuTechEmailDraft>> {
  try {
    const template = templateById(templateId)
    if (!template) return { success: false, error: "Unknown email template." }
    const ctx = await nuTechEmailContext(projectId, "read")
    const rendered = renderNuTechEmail(nuTechTemplateText(template, ctx.settings), ctx.context, ctx.fulfillment)
    const recipients = defaultRecipients(template.audience, ctx.customer?.email ?? null, ctx.settings)
    return {
      success: true,
      data: {
        templateId: template.id,
        label: template.label,
        audience: template.audience,
        senderAddress: ctx.settings.senderAddress,
        to: recipients.to,
        cc: recipients.cc,
        subject: rendered.subject,
        body: rendered.body,
        missing: rendered.missing,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to prepare the email." }
  }
}

function addressList(value: FormDataEntryValue | null): string[] {
  return typeof value === "string"
    ? value
        .split(/[,;\s]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    : []
}

/**
 * Send a reviewed Nu-Tech email from the company's Nu-Tech mailbox. Customer
 * emails are logged as client contacts, so they reset follow-up aging and
 * appear in the job's interaction history.
 */
export async function sendNuTechEmail(formData: FormData): Promise<Result<{ readonly loggedContact: boolean }>> {
  try {
    const projectId = formData.get("projectId")
    const templateId = formData.get("templateId")
    const subject = formData.get("subject")
    const body = formData.get("body")
    if (typeof projectId !== "string" || typeof templateId !== "string") return { success: false, error: "Missing job or template." }
    if (typeof subject !== "string" || subject.trim() === "" || typeof body !== "string" || body.trim() === "") {
      return { success: false, error: "Enter a subject and message." }
    }
    const template = templateById(templateId)
    if (!template) return { success: false, error: "Unknown email template." }
    const to = addressList(formData.get("to"))
    const cc = addressList(formData.get("cc"))
    if (to.length === 0) return { success: false, error: "Add at least one recipient." }
    const invalid = [...to, ...cc].find((address) => !EMAIL_PATTERN.test(address))
    if (invalid) return { success: false, error: `"${invalid}" is not an email address.` }

    const ctx = await nuTechEmailContext(projectId, "update")
    if (isDemoUser(ctx.user.id)) return { success: false, error: "Demo data cannot be changed." }
    if (!ctx.settings.senderAddress) {
      return { success: false, error: "Set the Nu-Tech sending mailbox in Settings → Workflows → Nu-Tech emails first." }
    }

    const files = formData.getAll("attachments").filter((entry): entry is File => entry instanceof File && entry.size > 0)
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > MAX_ATTACHMENT_BYTES) return { success: false, error: "Attachments are limited to 15 MB in total." }
    const attachments = await Promise.all(
      files.map(async (file) => ({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        content: new Uint8Array(await file.arrayBuffer()),
      })),
    )

    const delivery = await sendCompassEmail({
      env: ctx.env,
      db: ctx.db,
      organizationId: ctx.organizationId,
      to,
      cc,
      subject: subject.trim(),
      text: body,
      attachments,
      sender: { address: ctx.settings.senderAddress, name: ctx.settings.senderName || null },
    })
    if (delivery.status !== "sent") {
      return {
        success: false,
        error: `The email was not sent from ${ctx.settings.senderAddress}: ${delivery.error ?? delivery.status}. Check that the mailbox exists in Google Workspace and that Compass's Google connection may send as it.`,
      }
    }

    const now = new Date().toISOString()
    const loggedContact = template.audience === "customer"
    await ctx.db.batch([
      ctx.db.insert(projectProfileAuditEvents).values({
        id: crypto.randomUUID(),
        organizationId: ctx.organizationId,
        projectId,
        actorUserId: ctx.user.id,
        eventType: "nutech_email_sent",
        entityType: "project",
        entityId: projectId,
        beforeJson: null,
        afterJson: JSON.stringify({ templateId, to, cc, subject: subject.trim(), attachments: files.map((file) => file.name) }),
        createdAt: now,
      }),
      ...(loggedContact
        ? [
            ctx.db.insert(projectInteractions).values({
              id: crypto.randomUUID(),
              organizationId: ctx.organizationId,
              projectId,
              projectContactId: ctx.customer?.id ?? null,
              interactionType: "email",
              direction: "outbound",
              summary: `${template.label}: ${subject.trim()}`,
              source: "nutech_email",
              qualifiesForClientTouch: true,
              occurredAt: now,
              createdBy: ctx.user.id,
              updatedBy: ctx.user.id,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
              deletedBy: null,
            }),
          ]
        : []),
    ])
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/information`)
    return { success: true, data: { loggedContact } }
  } catch (error) {
    console.error("Nu-Tech email failed", error)
    return { success: false, error: error instanceof Error ? error.message : "Unable to send the email." }
  }
}
