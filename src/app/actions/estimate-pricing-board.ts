"use server"

import { and, eq, inArray, isNotNull } from "drizzle-orm"

import { createRfqRequest } from "@/app/actions/project-operations"
import { projectOperations } from "@/db/schema"
import { projectEstimateBasisDocuments, projectEstimateLines } from "@/db/schema-estimates"
import { projectRfqManualResponseEvents } from "@/db/schema-rfqs"
import { estimateAccess, requireEditableEstimate, revalidateEstimate } from "@/lib/estimates/access"
import { buildPricingBoard, packageSelectionProblem, type PricingBoard } from "@/lib/estimates/pricing-board"
import { isValidRecipientEmail, normalizeRecipientEmail } from "@/lib/email/recipient-options"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type EstimatePricingBoardView = {
  readonly board: PricingBoard
  /** The estimate's plans and specs with links; offered as the RFQ documents. */
  readonly documents: readonly { readonly id: string; readonly label: string; readonly url: string }[]
  readonly canEdit: boolean
}

export type EstimatePricingPackageInput = {
  readonly lineIds: readonly string[]
  readonly title: string
  readonly dueDate: string | null
  readonly notes: string | null
  readonly recipients: readonly { readonly name: string; readonly email: string }[]
  readonly documentIds: readonly string[]
  /** Project files picked in the file browser, as Drive links. */
  readonly extraDocuments: readonly { readonly label: string; readonly url: string }[]
}

const MAX_RECIPIENTS = 12
const MAX_LINES = 60

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

async function loadBoardInputs(access: Awaited<ReturnType<typeof estimateAccess>>, projectId: string, estimateId: string) {
  if (!access.organizationId) throw new Error("The project organization is required.")
  const [settings, lines, rfqs, documents] = await Promise.all([
    readFeatureSettings(access.db, access.organizationId, "estimate-pricing"),
    access.db
      .select({
        id: projectEstimateLines.id,
        costCode: projectEstimateLines.costCode,
        costCodeName: projectEstimateLines.costCodeName,
        description: projectEstimateLines.description,
        divisionCode: projectEstimateLines.divisionCode,
        specifications: projectEstimateLines.specifications,
        lineTotalCents: projectEstimateLines.lineTotalCents,
        pricingSource: projectEstimateLines.pricingSource,
        pricingTodoId: projectEstimateLines.pricingTodoId,
        sortOrder: projectEstimateLines.sortOrder,
      })
      .from(projectEstimateLines)
      .where(and(eq(projectEstimateLines.estimateId, estimateId), eq(projectEstimateLines.projectId, projectId), isNotNull(projectEstimateLines.pricingSource))),
    access.db
      .select({
        id: projectOperations.id,
        number: projectOperations.sourceRecordNumber,
        title: projectOperations.title,
        status: projectOperations.status,
        companyName: projectOperations.companyName,
        payloadJson: projectOperations.sagePayloadJson,
      })
      .from(projectOperations)
      .where(and(eq(projectOperations.projectId, projectId), eq(projectOperations.sourceRecordType, "rfq"))),
    access.db
      .select({ id: projectEstimateBasisDocuments.id, title: projectEstimateBasisDocuments.title, revision: projectEstimateBasisDocuments.revision, driveUrl: projectEstimateBasisDocuments.driveUrl })
      .from(projectEstimateBasisDocuments)
      .where(eq(projectEstimateBasisDocuments.estimateId, estimateId)),
  ])
  const rfqIds = rfqs.map((rfq) => rfq.id)
  const todoIds = lines.map((line) => line.pricingTodoId).filter((id): id is string => id !== null)
  const [manual, todos] = await Promise.all([
    rfqIds.length
      ? access.db
          .selectDistinct({ rfqOperationId: projectRfqManualResponseEvents.rfqOperationId })
          .from(projectRfqManualResponseEvents)
          .where(inArray(projectRfqManualResponseEvents.rfqOperationId, rfqIds))
      : Promise.resolve([]),
    todoIds.length
      ? access.db
          .select({ id: projectOperations.id, status: projectOperations.status, assigneeName: projectOperations.assigneeName })
          .from(projectOperations)
          .where(and(eq(projectOperations.projectId, projectId), inArray(projectOperations.id, todoIds)))
      : Promise.resolve([]),
  ])
  const manualIds = new Set(manual.map((row) => row.rfqOperationId))
  const todoById = new Map(todos.map((todo) => [todo.id, todo]))
  const board = buildPricingBoard({
    sources: settings.sources,
    lines: [...lines]
      .sort((a, b) => a.costCode.localeCompare(b.costCode) || a.sortOrder - b.sortOrder)
      .map((line) => {
        const todo = line.pricingTodoId ? todoById.get(line.pricingTodoId) : undefined
        return { ...line, todo: todo ? { status: todo.status, assigneeName: todo.assigneeName } : null }
      }),
    rfqs: rfqs.map((rfq) => ({ ...rfq, hasManualResponse: manualIds.has(rfq.id) })),
  })
  return {
    board,
    lines,
    documents: documents.flatMap((document) =>
      document.driveUrl ? [{ id: document.id, label: document.revision ? `${document.title} (rev ${document.revision})` : document.title, url: document.driveUrl }] : [],
    ),
  }
}

/** The estimate's pricing board: lines that need a number, and the RFQs asking for them. */
export async function getEstimatePricingBoard(projectId: string, estimateId: string): Promise<Result<EstimatePricingBoardView>> {
  try {
    const access = await estimateAccess(projectId, false)
    if (!isInternalStaffRole(access.user.role)) return { success: false, error: "The pricing board is for office staff." }
    const { board, documents } = await loadBoardInputs(access, projectId, estimateId)
    return { success: true, data: { board, documents, canEdit: true } }
  } catch (error) {
    return { success: false, error: message(error, "Could not load the pricing board.") }
  }
}

/**
 * Makes one draft RFQ per vendor for the chosen cost codes, grouped as one
 * bid package. Staff review and send each from the RFQs page.
 */
export async function createEstimatePricingPackage(
  projectId: string,
  estimateId: string,
  input: EstimatePricingPackageInput,
): Promise<Result<{ readonly rfqIds: readonly string[] }>> {
  try {
    const access = await estimateAccess(projectId, true)
    await requireEditableEstimate(access.db, projectId, estimateId)
    const title = input.title.trim()
    if (!title) return { success: false, error: "Name the package." }
    if (title.length > 200) return { success: false, error: "Keep the package name under 200 characters." }
    const lineIds = [...new Set(input.lineIds)]
    if (lineIds.length > MAX_LINES) return { success: false, error: `Send at most ${MAX_LINES} cost codes in one package.` }
    const recipients = input.recipients.map((recipient) => ({ name: recipient.name.trim(), email: normalizeRecipientEmail(recipient.email) }))
    if (recipients.length === 0) return { success: false, error: "Choose at least one vendor." }
    if (recipients.length > MAX_RECIPIENTS) return { success: false, error: `Choose at most ${MAX_RECIPIENTS} vendors at a time.` }
    const badRecipient = recipients.find((recipient) => !recipient.name || !isValidRecipientEmail(recipient.email))
    if (badRecipient) return { success: false, error: `${badRecipient.name || "A vendor"} needs a name and a valid email.` }
    if (new Set(recipients.map((recipient) => recipient.email)).size !== recipients.length) {
      return { success: false, error: "Each vendor can only be chosen once." }
    }

    const { board, lines, documents } = await loadBoardInputs(access, projectId, estimateId)
    const chosen = board.lines.filter((line) => lineIds.includes(line.id))
    if (chosen.length !== lineIds.length) return { success: false, error: "A chosen line is no longer on this estimate or has no \"Priced by\" choice." }
    const problem = packageSelectionProblem(chosen)
    if (problem) return { success: false, error: problem }
    if (input.extraDocuments.length > 40) return { success: false, error: "Include at most 40 files." }
    const chosenDocuments = [
      ...documents.filter((document) => input.documentIds.includes(document.id)),
      ...input.extraDocuments.map((document, index) => ({ id: `picked-${index}`, label: document.label.trim().slice(0, 200) || "Project file", url: document.url.trim() })),
    ]
    const source = chosen[0]?.source
    if (!source) return { success: false, error: "Choose at least one cost code." }

    const scopeItems = chosen.map((line) => {
      const full = lines.find((row) => row.id === line.id)
      return {
        description: line.description,
        costCode: line.costCode,
        phaseCode: full?.divisionCode ?? null,
        notes: full?.specifications?.slice(0, 2_000) ?? null,
      }
    })
    const packageId = crypto.randomUUID()
    const rfqIds: string[] = []
    for (const recipient of recipients) {
      const created = await createRfqRequest(projectId, {
        title,
        vendorCategory: source.label,
        requestedFrom: recipient.name,
        recipientEmail: recipient.email,
        responseDueDate: input.dueDate?.trim() || null,
        priority: "normal",
        scope: input.notes?.trim() || null,
        scopeItems,
        documentLinks: chosenDocuments.map((document) => ({ label: document.label, url: document.url, notes: null })),
        estimatePackage: { id: packageId, title, estimateId },
      })
      if (!created.success) {
        const made = rfqIds.length ? ` ${rfqIds.length} draft RFQ${rfqIds.length === 1 ? " was" : "s were"} made before this; find them on the RFQs page.` : ""
        return { success: false, error: `${recipient.name}: ${created.error}${made}` }
      }
      rfqIds.push(created.id)
    }
    revalidateEstimate(projectId)
    return { success: true, data: { rfqIds } }
  } catch (error) {
    return { success: false, error: message(error, "Could not make the RFQs.") }
  }
}
