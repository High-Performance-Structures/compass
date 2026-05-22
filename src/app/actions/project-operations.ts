"use server"

import { and, asc, eq, gte, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectContacts,
  projectOperations,
  projectPurchaseOrderLines,
  projects,
  scheduleTasks,
  vendors,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"

export type ProjectOperationItem = {
  readonly id: string
  readonly sourceSystem: string
  readonly sourceRecordType: string
  readonly sourceRecordNumber: string | null
  readonly title: string
  readonly description: string | null
  readonly status: string
  readonly priority: string
  readonly assigneeType: string | null
  readonly assigneeName: string | null
  readonly companyName: string | null
  readonly costCode: string | null
  readonly startDate: string | null
  readonly dueDate: string | null
  readonly amount: number | null
  readonly syncStatus: string
  readonly sageJobId: string | null
  readonly sageJobNumber: string | null
  readonly sageVendorId: string | null
  readonly sageVendorName: string | null
  readonly sagePhaseCode: string | null
  readonly sageCostCode: string | null
  readonly sageTaxGroup: string | null
  readonly sageShipTo: string | null
  readonly sageOrderDate: string | null
  readonly sageRequiredDate: string | null
  readonly sageWriteStatus: string
  readonly sagePayloadJson: string | null
}

export type ProjectPurchaseOrderLineItem = {
  readonly id: string
  readonly operationId: string
  readonly lineNumber: number
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly description: string
  readonly quantity: number
  readonly unitCost: number
  readonly unit: string | null
  readonly amount: number
  readonly taxGroup: string | null
  readonly syncStatus: string
}

export type ProjectPurchaseOrderItem = ProjectOperationItem & {
  readonly lines: readonly ProjectPurchaseOrderLineItem[]
  readonly vendorEmail: string | null
}

export type NextScheduleItem = {
  readonly id: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly assignedTo: string | null
  readonly source: "compass_schedule" | "sage_operation"
}

export type ProjectOperationsSummary = {
  readonly openPurchaseOrderCount: number
  readonly openPurchaseOrderTotal: number
  readonly activeCommitmentCount: number
  readonly nextScheduleItem: NextScheduleItem | null
  readonly purchaseOrders: readonly ProjectOperationItem[]
  readonly commitments: readonly ProjectOperationItem[]
}

type ProjectOperationActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

type ProjectOperationEmailActionResult =
  | {
      readonly success: true
      readonly status: string
      readonly providerMessageId: string | null
    }
  | { readonly success: false; readonly error: string }

export type CreatePurchaseOrderRequestInput = {
  readonly title: string
  readonly description: string | null
  readonly companyName: string | null
  readonly sageVendorId: string | null
  readonly assigneeName: string | null
  readonly shipTo: string | null
  readonly orderDate: string | null
  readonly dueDate: string | null
  readonly priority: string
  readonly lines: readonly CreatePurchaseOrderLineInput[]
}

export type CreatePurchaseOrderLineInput = {
  readonly description: string | null
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly quantity: number | null
  readonly unitCost: number | null
  readonly unit: string | null
  readonly amount: number | null
  readonly taxGroup: string | null
}

export type SendPurchaseOrderEmailInput = {
  readonly to: string
  readonly cc: string | null
  readonly subject: string
  readonly message: string
}

type SagePurchaseOrderPayload = {
  readonly source: "compass_po_request"
  readonly header: {
    readonly jobId: string | null
    readonly jobNumber: string | null
    readonly vendorId: string | null
    readonly vendorName: string | null
    readonly poNumber: string | null
    readonly description: string
    readonly orderDate: string | null
    readonly requiredDate: string | null
    readonly shipTo: string | null
    readonly status: string
  }
  readonly lines: readonly {
    readonly lineNumber: number
    readonly phaseCode: string | null
    readonly costCode: string | null
    readonly description: string
    readonly quantity: number
    readonly unitCost: number
    readonly unit: string | null
    readonly amount: number
    readonly taxGroup: string | null
  }[]
}

type NormalizedPurchaseOrderLine = {
  readonly lineNumber: number
  readonly description: string
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly quantity: number
  readonly unitCost: number
  readonly unit: string | null
  readonly amount: number
  readonly taxGroup: string | null
}

async function verifyProjectAccess(
  projectId: string
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  requirePermission(user, "project", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!existing[0]) {
    throw new Error("Project not found")
  }

  return db
}

async function verifyProjectUpdateAccess(
  projectId: string
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  requirePermission(user, "project", "update")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!existing[0]) {
    throw new Error("Project not found")
  }

  return db
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`${label} is required`)
  }
  return trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function envString(env: unknown, key: string): string | null {
  if (!isRecord(env)) return process.env[key] ?? null
  const value = env[key]
  return typeof value === "string" && value.trim().length > 0
    ? value
    : process.env[key] ?? null
}

function normalizeComparableName(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function formatMoney(value: number | null): string {
  if (value === null) return "Amount TBD"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value)
}

function formatEmailDate(value: string | null): string {
  if (!value) return "Not specified"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function parseEmailList(value: string | null): readonly string[] {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) return []
  return trimmed
    .split(/[,\s;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
}

function purchaseOrderRequestNumberFor(existingCount: number): string {
  return `PO-REQ-${String(existingCount + 1).padStart(3, "0")}`
}

function numberOrDefault(value: number | null, fallback: number): number {
  return value === null || !Number.isFinite(value) ? fallback : value
}

function normalizePurchaseOrderLines(
  lines: readonly CreatePurchaseOrderLineInput[],
  fallbackDescription: string
): readonly NormalizedPurchaseOrderLine[] {
  const normalized = lines
    .map((line, index) => {
      const description = cleanText(line.description)
      const costCode = cleanText(line.costCode)
      const phaseCode = cleanText(line.phaseCode)
      const taxGroup = cleanText(line.taxGroup)
      const unit = cleanText(line.unit)
      const quantity = numberOrDefault(line.quantity, 1)
      const unitCost = numberOrDefault(line.unitCost, 0)
      const amount = numberOrDefault(line.amount, quantity * unitCost)
      const hasMeaningfulValue =
        description !== null ||
        costCode !== null ||
        phaseCode !== null ||
        taxGroup !== null ||
        unit !== null ||
        amount > 0 ||
        unitCost > 0

      if (!hasMeaningfulValue) return null

      return {
        lineNumber: index + 1,
        description: description ?? fallbackDescription,
        costCode,
        phaseCode,
        quantity,
        unitCost,
        unit,
        amount,
        taxGroup,
      }
    })
    .filter((line) => line !== null)

  if (normalized.length > 0) return normalized

  return [
    {
      lineNumber: 1,
      description: fallbackDescription,
      costCode: null,
      phaseCode: null,
      quantity: 1,
      unitCost: 0,
      unit: null,
      amount: 0,
      taxGroup: null,
    },
  ]
}

function buildSagePurchaseOrderPayload(input: {
  readonly project: {
    readonly sageJobId: string | null
    readonly sageJobNumber: string | null
  }
  readonly sourceRecordNumber: string
  readonly title: string
  readonly description: string | null
  readonly companyName: string | null
  readonly sageVendorId: string | null
  readonly shipTo: string | null
  readonly orderDate: string | null
  readonly dueDate: string | null
  readonly lines: readonly NormalizedPurchaseOrderLine[]
}): SagePurchaseOrderPayload {
  return {
    source: "compass_po_request",
    header: {
      jobId: input.project.sageJobId,
      jobNumber: input.project.sageJobNumber,
      vendorId: input.sageVendorId,
      vendorName: input.companyName,
      poNumber: input.sourceRecordNumber,
      description: input.title,
      orderDate: input.orderDate,
      requiredDate: input.dueDate,
      shipTo: input.shipTo,
      status: "draft",
    },
    lines: input.lines.map((line) => ({
      lineNumber: line.lineNumber,
      phaseCode: line.phaseCode,
      costCode: line.costCode,
      description: line.description,
      quantity: line.quantity,
      unitCost: line.unitCost,
      unit: line.unit,
      amount: line.amount,
      taxGroup: line.taxGroup,
    })),
  }
}

function toOperationItem(row: typeof projectOperations.$inferSelect): ProjectOperationItem {
  return {
    id: row.id,
    sourceSystem: row.sourceSystem,
    sourceRecordType: row.sourceRecordType,
    sourceRecordNumber: row.sourceRecordNumber,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeType: row.assigneeType,
    assigneeName: row.assigneeName,
    companyName: row.companyName,
    costCode: row.costCode,
    startDate: row.startDate,
    dueDate: row.dueDate,
    amount: row.amount,
    syncStatus: row.syncStatus,
    sageJobId: row.sageJobId,
    sageJobNumber: row.sageJobNumber,
    sageVendorId: row.sageVendorId,
    sageVendorName: row.sageVendorName,
    sagePhaseCode: row.sagePhaseCode,
    sageCostCode: row.sageCostCode,
    sageTaxGroup: row.sageTaxGroup,
    sageShipTo: row.sageShipTo,
    sageOrderDate: row.sageOrderDate,
    sageRequiredDate: row.sageRequiredDate,
    sageWriteStatus: row.sageWriteStatus,
    sagePayloadJson: row.sagePayloadJson,
  }
}

function toPurchaseOrderLineItem(
  row: typeof projectPurchaseOrderLines.$inferSelect
): ProjectPurchaseOrderLineItem {
  return {
    id: row.id,
    operationId: row.operationId,
    lineNumber: row.lineNumber,
    costCode: row.costCode,
    phaseCode: row.phaseCode,
    description: row.description,
    quantity: row.quantity,
    unitCost: row.unitCost,
    unit: row.unit,
    amount: row.amount,
    taxGroup: row.taxGroup,
    syncStatus: row.syncStatus,
  }
}

function purchaseOrderVendorEmail(
  order: typeof projectOperations.$inferSelect,
  contactRows: readonly {
    readonly displayName: string
    readonly companyName: string | null
    readonly email: string | null
  }[],
  vendorRows: readonly {
    readonly name: string
    readonly email: string | null
    readonly netsuiteId: string | null
    readonly sourceRecordId: string | null
    readonly sourceRecordNumber: string | null
  }[]
): string | null {
  const vendorKeys = [
    order.companyName,
    order.sageVendorName,
    order.sageVendorId,
  ].map(normalizeComparableName)

  const matchingContact = contactRows.find((contact) => {
    if (!contact.email) return false
    const contactKeys = [
      contact.companyName,
      contact.displayName,
    ].map(normalizeComparableName)
    return contactKeys.some((key) => key.length > 0 && vendorKeys.includes(key))
  })
  if (matchingContact?.email) return matchingContact.email

  const matchingVendor = vendorRows.find((vendor) => {
    if (!vendor.email) return false
    const vendorIds = [
      vendor.netsuiteId,
      vendor.sourceRecordId,
      vendor.sourceRecordNumber,
    ].map(normalizeComparableName)
    const vendorName = normalizeComparableName(vendor.name)
    return (
      vendorIds.some((id) => id.length > 0 && vendorKeys.includes(id)) ||
      (vendorName.length > 0 && vendorKeys.includes(vendorName))
    )
  })

  return matchingVendor?.email ?? null
}

function purchaseOrderEmailText(input: {
  readonly projectName: string
  readonly projectNumber: string | null
  readonly senderName: string
  readonly message: string
  readonly order: ProjectPurchaseOrderItem
}): string {
  const lines = input.order.lines.map((line) =>
    [
      `${line.lineNumber}. ${line.description}`,
      `Phase: ${line.phaseCode ?? "-"}`,
      `Cost Code: ${line.costCode ?? "-"}`,
      `Qty: ${line.quantity} ${line.unit ?? ""}`.trim(),
      `Unit Cost: ${formatMoney(line.unitCost)}`,
      `Amount: ${formatMoney(line.amount)}`,
    ].join(" | ")
  )

  return [
    input.message,
    "",
    "Purchase Order",
    `P.O.: ${input.order.sourceRecordNumber ?? "Unnumbered"}`,
    `Project: ${input.projectNumber ? `${input.projectNumber} - ` : ""}${input.projectName}`,
    `Vendor: ${input.order.companyName ?? "Vendor TBD"}`,
    `Order Date: ${formatEmailDate(input.order.sageOrderDate)}`,
    `Required By: ${formatEmailDate(input.order.dueDate)}`,
    `Ship To / Pickup: ${input.order.sageShipTo ?? "TBD"}`,
    "",
    "Line Items",
    ...lines,
    "",
    `Total: ${formatMoney(input.order.amount)}`,
    "",
    `Sent through Compass by ${input.senderName}.`,
  ].join("\n")
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function purchaseOrderEmailHtml(input: {
  readonly projectName: string
  readonly projectNumber: string | null
  readonly senderName: string
  readonly message: string
  readonly order: ProjectPurchaseOrderItem
}): string {
  const projectLabel = `${input.projectNumber ? `${input.projectNumber} - ` : ""}${input.projectName}`
  const rows = input.order.lines
    .map(
      (line) => `
        <tr>
          <td>${line.lineNumber}</td>
          <td>${escapeHtml(line.description)}</td>
          <td>${escapeHtml(line.phaseCode ?? "-")}</td>
          <td>${escapeHtml(line.costCode ?? "-")}</td>
          <td style="text-align:right;">${line.quantity}</td>
          <td>${escapeHtml(line.unit ?? "-")}</td>
          <td style="text-align:right;">${formatMoney(line.unitCost)}</td>
          <td style="text-align:right;font-weight:600;">${formatMoney(line.amount)}</td>
        </tr>`
    )
    .join("")

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.45;">
      <p>${escapeHtml(input.message).replaceAll("\n", "<br>")}</p>
      <h2 style="margin-top:24px;margin-bottom:4px;">Purchase Order</h2>
      <p style="margin:0 0 16px 0;color:#4b5563;">
        ${escapeHtml(input.order.sourceRecordNumber ?? "Unnumbered")}
      </p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:18px;">
        <tbody>
          <tr><td style="font-weight:700;width:160px;">Project</td><td>${escapeHtml(projectLabel)}</td></tr>
          <tr><td style="font-weight:700;">Vendor</td><td>${escapeHtml(input.order.companyName ?? "Vendor TBD")}</td></tr>
          <tr><td style="font-weight:700;">Order Date</td><td>${formatEmailDate(input.order.sageOrderDate)}</td></tr>
          <tr><td style="font-weight:700;">Required By</td><td>${formatEmailDate(input.order.dueDate)}</td></tr>
          <tr><td style="font-weight:700;">Ship To / Pickup</td><td>${escapeHtml(input.order.sageShipTo ?? "TBD")}</td></tr>
        </tbody>
      </table>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead>
          <tr>
            <th style="border:1px solid #111827;padding:6px;text-align:left;">Line</th>
            <th style="border:1px solid #111827;padding:6px;text-align:left;">Description</th>
            <th style="border:1px solid #111827;padding:6px;text-align:left;">Phase</th>
            <th style="border:1px solid #111827;padding:6px;text-align:left;">Cost Code</th>
            <th style="border:1px solid #111827;padding:6px;text-align:right;">Qty</th>
            <th style="border:1px solid #111827;padding:6px;text-align:left;">Unit</th>
            <th style="border:1px solid #111827;padding:6px;text-align:right;">Unit Cost</th>
            <th style="border:1px solid #111827;padding:6px;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="7" style="border:1px solid #111827;padding:6px;text-align:right;font-weight:700;">Total</td>
            <td style="border:1px solid #111827;padding:6px;text-align:right;font-weight:700;">${formatMoney(input.order.amount)}</td>
          </tr>
        </tfoot>
      </table>
      <p style="margin-top:20px;color:#4b5563;font-size:12px;">
        Sent through Compass by ${escapeHtml(input.senderName)}.
      </p>
    </div>`
}

async function sendResendPurchaseOrderEmail(
  env: unknown,
  input: {
    readonly to: readonly string[]
    readonly cc: readonly string[]
    readonly subject: string
    readonly text: string
    readonly html: string
  }
): Promise<{
  readonly status: string
  readonly providerMessageId: string | null
  readonly error: string | null
}> {
  const apiKey = envString(env, "RESEND_API_KEY")
  if (!apiKey) {
    return {
      status: "pending_provider",
      providerMessageId: null,
      error: "RESEND_API_KEY is not configured",
    }
  }

  const fromAddress =
    envString(env, "COMPASS_EMAIL_FROM") ??
    "Compass <notifications@compass.build>"
  const requestBody: Record<string, unknown> = {
    from: fromAddress,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  }
  if (input.cc.length > 0) {
    requestBody.cc = input.cc
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  })

  const responseText = await response.text()
  let providerMessageId: string | null = null
  try {
    const parsed = JSON.parse(responseText)
    if (isRecord(parsed) && typeof parsed.id === "string") {
      providerMessageId = parsed.id
    }
  } catch {
    providerMessageId = null
  }

  return {
    status: response.ok ? "sent" : "failed",
    providerMessageId,
    error: response.ok ? null : responseText.slice(0, 500),
  }
}

function operationToScheduleItem(
  operation: typeof projectOperations.$inferSelect
): NextScheduleItem {
  return {
    id: operation.id,
    title: operation.title,
    startDate: operation.startDate ?? operation.dueDate ?? "",
    endDate: operation.dueDate ?? operation.startDate ?? "",
    assignedTo: operation.assigneeName ?? operation.companyName,
    source: "sage_operation",
  }
}

export async function getProjectOperationsSummary(
  projectId: string
): Promise<ProjectOperationsSummary> {
  const db = await verifyProjectAccess(projectId)
  const today = new Date().toISOString().slice(0, 10)

  const operations = await db
    .select()
    .from(projectOperations)
    .where(eq(projectOperations.projectId, projectId))
    .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title))

  const purchaseOrders = operations.filter(
    (operation) => operation.sourceRecordType === "purchase_order"
  )
  const commitments = operations.filter((operation) =>
    [
      "staff_task",
      "subcontractor_task",
      "supplier_task",
      "schedule_task",
    ].includes(operation.sourceRecordType)
  )

  const openPurchaseOrders = purchaseOrders.filter(
    (operation) => !["closed", "void", "complete"].includes(operation.status)
  )
  const activeCommitments = commitments.filter(
    (operation) => !["complete", "cancelled"].includes(operation.status)
  )

  const [nextCompassTask] = await db
    .select()
    .from(scheduleTasks)
    .where(
      and(
        eq(scheduleTasks.projectId, projectId),
        gte(scheduleTasks.endDateCalculated, today),
        inArray(scheduleTasks.status, ["PENDING", "IN_PROGRESS"])
      )
    )
    .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))
    .limit(1)

  const nextSageOperation = activeCommitments.find(
    (operation) =>
      (operation.startDate !== null && operation.startDate >= today) ||
      (operation.dueDate !== null && operation.dueDate >= today)
  )

  const nextScheduleItem = nextCompassTask
    ? {
        id: nextCompassTask.id,
        title: nextCompassTask.title,
        startDate: nextCompassTask.startDate,
        endDate: nextCompassTask.endDateCalculated,
        assignedTo: nextCompassTask.assignedTo,
        source: "compass_schedule" as const,
      }
    : nextSageOperation
      ? operationToScheduleItem(nextSageOperation)
      : null

  return {
    openPurchaseOrderCount: openPurchaseOrders.length,
    openPurchaseOrderTotal: openPurchaseOrders.reduce(
      (total, operation) => total + (operation.amount ?? 0),
      0
    ),
    activeCommitmentCount: activeCommitments.length,
    nextScheduleItem,
    purchaseOrders: purchaseOrders.slice(0, 5).map(toOperationItem),
    commitments: commitments.slice(0, 6).map(toOperationItem),
  }
}

export async function getProjectPurchaseOrders(
  projectId: string
): Promise<readonly ProjectPurchaseOrderItem[]> {
  const user = await requireAuth()
  const orgId = requireOrg(user)
  const db = await verifyProjectAccess(projectId)
  const rows = await db
    .select()
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceRecordType, "purchase_order")
      )
    )
    .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title))

  if (rows.length === 0) return []

  const lines = await db
    .select()
    .from(projectPurchaseOrderLines)
    .where(
      inArray(
        projectPurchaseOrderLines.operationId,
        rows.map((row) => row.id)
      )
    )
    .orderBy(
      asc(projectPurchaseOrderLines.operationId),
      asc(projectPurchaseOrderLines.lineNumber)
    )

  const [contactRows, vendorRows] = await Promise.all([
    db
      .select({
        displayName: projectContacts.displayName,
        companyName: projectContacts.companyName,
        email: projectContacts.email,
      })
      .from(projectContacts)
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true))),
    db
      .select({
        name: vendors.name,
        email: vendors.email,
        netsuiteId: vendors.netsuiteId,
        sourceRecordId: vendors.sourceRecordId,
        sourceRecordNumber: vendors.sourceRecordNumber,
      })
      .from(vendors)
      .where(eq(vendors.organizationId, orgId)),
  ])

  const linesByOperation = new Map<string, ProjectPurchaseOrderLineItem[]>()
  for (const line of lines.map(toPurchaseOrderLineItem)) {
    const existing = linesByOperation.get(line.operationId) ?? []
    existing.push(line)
    linesByOperation.set(line.operationId, existing)
  }

  return rows.map((row) => ({
    ...toOperationItem(row),
    lines: linesByOperation.get(row.id) ?? [],
    vendorEmail: purchaseOrderVendorEmail(row, contactRows, vendorRows),
  }))
}

export async function createPurchaseOrderRequest(
  projectId: string,
  input: CreatePurchaseOrderRequestInput
): Promise<ProjectOperationActionResult> {
  try {
    const db = await verifyProjectUpdateAccess(projectId)
    const [project] = await db
      .select({
        sageJobId: projects.sageJobId,
        sageJobNumber: projects.sageJobNumber,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    const purchaseOrders = await db
      .select({ id: projectOperations.id })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "purchase_order")
        )
      )

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const sourceRecordNumber = purchaseOrderRequestNumberFor(purchaseOrders.length)
    const title = requireText(input.title, "Title")
    const description = cleanText(input.description)
    const companyName = cleanText(input.companyName)
    const shipTo = cleanText(input.shipTo)
    const orderDate = cleanText(input.orderDate) ?? now.slice(0, 10)
    const dueDate = cleanText(input.dueDate)
    const lines = normalizePurchaseOrderLines(input.lines, description ?? title)
    const amount = lines.reduce((total, line) => total + line.amount, 0)
    const headerCostCode = lines.length === 1 ? lines[0]?.costCode ?? null : null
    const headerPhaseCode = lines.length === 1 ? lines[0]?.phaseCode ?? null : null
    const headerTaxGroup = lines.length === 1 ? lines[0]?.taxGroup ?? null : null
    const sagePayload = buildSagePurchaseOrderPayload({
      project: project ?? { sageJobId: null, sageJobNumber: null },
      sourceRecordNumber,
      title,
      description,
      companyName,
      sageVendorId: cleanText(input.sageVendorId),
      shipTo,
      orderDate,
      dueDate,
      lines,
    })
    const sagePayloadJson = JSON.stringify(sagePayload)
    const inserted: typeof projectOperations.$inferInsert = {
      id,
      projectId,
      sourceSystem: "compass",
      sourceRecordType: "purchase_order",
      sourceRecordNumber,
      title,
      description,
      status: "draft",
      priority: input.priority,
      assigneeType: "vendor",
      assigneeName: cleanText(input.assigneeName),
      companyName,
      costCode: headerCostCode,
      dueDate,
      amount,
      sageJobId: project?.sageJobId ?? null,
      sageJobNumber: project?.sageJobNumber ?? null,
      sageVendorId: cleanText(input.sageVendorId),
      sageVendorName: companyName,
      sagePhaseCode: headerPhaseCode,
      sageCostCode: headerCostCode,
      sageTaxGroup: headerTaxGroup,
      sageShipTo: shipTo,
      sageOrderDate: orderDate,
      sageRequiredDate: dueDate,
      sageWriteStatus: "draft_ready",
      sagePayloadJson,
      syncDirection: "write",
      syncStatus: "pending_sage",
      createdAt: now,
      updatedAt: now,
    }

    await db.insert(projectOperations).values(inserted)
    await db.insert(projectPurchaseOrderLines).values(
      lines.map((line) => ({
        id: crypto.randomUUID(),
        operationId: id,
        projectId,
        sourceSystem: "compass",
        sourceRecordId: null,
        lineNumber: line.lineNumber,
        costCode: line.costCode,
        phaseCode: line.phaseCode,
        description: line.description,
        quantity: line.quantity,
        unitCost: line.unitCost,
        unit: line.unit,
        amount: line.amount,
        taxGroup: line.taxGroup,
        sagePayloadJson: JSON.stringify(line),
        syncStatus: "pending_sage",
        createdAt: now,
        updatedAt: now,
      }))
    )
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath("/dashboard/purchase-orders")
    revalidatePath("/dashboard/financials")
    revalidatePath("/dashboard/schedule")

    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create purchase order request",
    }
  }
}

export async function sendPurchaseOrderEmail(
  projectId: string,
  purchaseOrderId: string,
  input: SendPurchaseOrderEmailInput
): Promise<ProjectOperationEmailActionResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "project", "update")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const to = parseEmailList(input.to)
    const cc = parseEmailList(input.cc)
    const subject = requireText(input.subject, "Subject")
    const message = requireText(input.message, "Message")

    if (to.length === 0) {
      return { success: false, error: "Enter at least one supplier email." }
    }

    const [project] = await db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found." }
    }

    const [operation] = await db
      .select()
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.id, purchaseOrderId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "purchase_order")
        )
      )
      .limit(1)

    if (!operation) {
      return { success: false, error: "Purchase order not found." }
    }

    const lineRows = await db
      .select()
      .from(projectPurchaseOrderLines)
      .where(eq(projectPurchaseOrderLines.operationId, purchaseOrderId))
      .orderBy(asc(projectPurchaseOrderLines.lineNumber))

    const order: ProjectPurchaseOrderItem = {
      ...toOperationItem(operation),
      lines: lineRows.map(toPurchaseOrderLineItem),
      vendorEmail: null,
    }
    const senderName = user.displayName ?? user.email
    const emailInput = {
      projectName: project.name,
      projectNumber: project.projectNumber,
      senderName,
      message,
      order,
    }
    const delivery = await sendResendPurchaseOrderEmail(env, {
      to,
      cc,
      subject,
      text: purchaseOrderEmailText(emailInput),
      html: purchaseOrderEmailHtml(emailInput),
    })

    if (delivery.status === "failed") {
      return {
        success: false,
        error: delivery.error ?? "Unable to send purchase order email.",
      }
    }

    const now = new Date().toISOString()
    await db
      .update(projectOperations)
      .set({
        status: "sent",
        updatedAt: now,
      })
      .where(eq(projectOperations.id, purchaseOrderId))

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath("/dashboard/purchase-orders")

    return {
      success: true,
      status: delivery.status,
      providerMessageId: delivery.providerMessageId,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to send purchase order email.",
    }
  }
}
