import { and, eq, like } from "drizzle-orm"

import {
  projectEstimateAssemblies,
  projectEstimateLines,
  projectEstimateReportPhases,
  projectEstimates,
} from "@/db/schema-estimates"
import { googleAuth } from "@/db/schema-google"
import { loadProjectCostCodeCatalog } from "@/lib/cost-codes/catalog-server"
import { decrypt } from "@/lib/crypto"
import type { EstimateAccess } from "@/lib/domain/estimates/access"
import {
  calculateEstimateTotals,
  ledgerLine,
  planSwiftLinePricing,
  requiredText,
} from "@/lib/domain/estimates/rules"
import {
  deleteEstimateAssembliesStatement,
  deleteEstimateLinesStatement,
  deleteEstimateReportPhasesStatement,
  insertEstimateAssemblyStatement,
  insertEstimateLineStatement,
  insertEstimateReportPhaseStatement,
  updateEstimatesStatement,
} from "@/lib/domain/estimates/store"
import type {
  ProjectEstimateBuildertrendImportInput,
  ProjectEstimatePlanSwiftImportInput,
} from "@/lib/domain/estimates/types"
import { parseProjectTotalsRows, spreadsheetIdFromUrl } from "@/lib/financials/project-totals-import"
import { SheetsClient } from "@/lib/google/client/sheets-client"
import { getGoogleConfig, getGoogleCryptoSalt, parseServiceAccountKey } from "@/lib/google/config"
import { cleanText } from "@/lib/shared/guards"

/**
 * Line importers: the Google Sheets "Project Totals" CSI workbook, PlanSwift
 * rows, and a Buildertrend estimate export. Callers check access and pass the
 * editable estimate. Stored amounts are computed here from the imported
 * inputs, never taken from the browser.
 */

type EstimateRow = typeof projectEstimates.$inferSelect

const PROJECT_TOTALS_RANGE = "Project Totals!A1:AA506"

type ImportCount = {
  readonly lineCount: number
  readonly totalCents: number
}

export async function importEstimateFromGoogleSheet(
  access: EstimateAccess,
  projectId: string,
  estimate: EstimateRow
): Promise<ImportCount & { readonly roundingAdjustmentCents: number; readonly missingSageMappingCount: number }> {
  const estimateId = estimate.id
  const spreadsheetId = spreadsheetIdFromUrl(estimate.sourceWorkbookUrl)
  if (!spreadsheetId) {
    throw new Error("Save a valid Google Sheets Source CSI workbook before importing.")
  }

  const authRows = access.organizationId
    ? await access.db
        .select()
        .from(googleAuth)
        .where(eq(googleAuth.organizationId, access.organizationId))
        .limit(1)
    : await access.db.select().from(googleAuth).limit(1)
  const auth = authRows[0]
  if (!auth) {
    throw new Error("Google Workspace service account is not connected.")
  }

  const config = getGoogleConfig(access.env)
  const keyJson = await decrypt(auth.serviceAccountKeyEncrypted, config.encryptionKey, getGoogleCryptoSalt())
  const client = new SheetsClient(parseServiceAccountKey(keyJson))
  const googleEmail = access.user.googleEmail ?? access.user.email
  const rows = await client.getValues(googleEmail, {
    spreadsheetId,
    range: PROJECT_TOTALS_RANGE,
    valueRenderOption: "UNFORMATTED_VALUE",
  })
  const parsed = parseProjectTotalsRows(rows)
  if (!parsed.success) throw new Error(parsed.error)

  const sourceCostCodes = parsed.lines.map((line) => line.costCode)
  const costCodeCatalog = await loadProjectCostCodeCatalog(access.db)
  const activeCostCodes = new Set(costCodeCatalog.filter((row) => row.sageMapped).map((row) => row.code))
  const missingCostCodes = sourceCostCodes.filter((code) => !activeCostCodes.has(code))
  const missingCostCodeSet = new Set(missingCostCodes)

  const now = new Date().toISOString()
  const lineValues = parsed.lines.map((line) => {
    const mappingNote = missingCostCodeSet.has(line.costCode)
      ? `Source CSI cost code ${line.costCode} is not active in Sage; remap before signature or accounting handoff.`
      : null
    return {
      id: crypto.randomUUID(),
      projectId,
      estimateId,
      divisionCode: line.divisionCode,
      divisionName: line.divisionName,
      costCode: line.costCode,
      costCodeName: line.costCodeName,
      description: line.description,
      specifications: [line.specifications, mappingNote].filter(Boolean).join(" ") || null,
      quantity: 1,
      unit: "LS",
      unitCostCents: line.amountCents,
      directCostCents: line.amountCents,
      markupRateBasisPoints: 0,
      markupCents: 0,
      taxable: false,
      taxEntityId: null,
      taxCode: null,
      taxName: null,
      taxRateBasisPoints: 0,
      taxCents: 0,
      lineTotalCents: line.amountCents,
      ownerVisible: true,
      includeInBuilderFee: true,
      sortOrder: line.sortOrder,
      createdAt: now,
      updatedAt: now,
    }
  })
  const [firstLine, ...remainingLines] = lineValues
  if (!firstLine) {
    throw new Error("Project Totals did not produce any importable lines.")
  }

  // The workbook's own totals and builder-fee amounts are kept to the cent.
  await access.db.batch([
    deleteEstimateLinesStatement(access.db, eq(projectEstimateLines.estimateId, estimateId)),
    insertEstimateLineStatement(access.db, firstLine),
    ...remainingLines.map((lineValue) => insertEstimateLineStatement(access.db, lineValue)),
    updateEstimatesStatement(access.db, eq(projectEstimates.id, estimateId), {
      sourceSystem: "google_csi_project_totals",
      sourceWorkbookId: spreadsheetId,
      sourceRevision: `Project Totals imported ${now}`,
      directCostCents: parsed.projectSubtotalCents,
      markupCents: 0,
      taxCents: 0,
      builderFeeBaseCents: parsed.projectSubtotalCents,
      overheadRateBasisPoints: parsed.overheadRateBasisPoints,
      overheadCents: parsed.overheadCents,
      marginRateBasisPoints: parsed.marginRateBasisPoints,
      marginCents: parsed.marginCents,
      contingencyRateBasisPoints: parsed.contingencyRateBasisPoints,
      contingencyCents: parsed.contingencyCents,
      builderFeeCents: parsed.overheadCents + parsed.marginCents + parsed.contingencyCents,
      estimateTotalCents: parsed.displayedTotalCents,
      updatedAt: now,
    }),
  ])

  return {
    lineCount: parsed.lines.length,
    totalCents: parsed.displayedTotalCents,
    roundingAdjustmentCents: parsed.roundingAdjustmentCents,
    missingSageMappingCount: missingCostCodes.length,
  }
}

/** D1 allows 100 bound parameters per statement; a line binds 27 columns, so three rows fit. */
function lineChunks<T>(rows: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) =>
    rows.slice(index * size, index * size + size)
  )
}

export async function importPlanSwiftLines(
  access: EstimateAccess,
  projectId: string,
  estimate: EstimateRow,
  input: ProjectEstimatePlanSwiftImportInput
): Promise<ImportCount> {
  const estimateId = estimate.id
  if (input.lines.length === 0) {
    throw new Error("Select at least one PlanSwift row to import.")
  }
  if (input.lines.length > 2_000) {
    throw new Error("PlanSwift imports are limited to 2,000 rows.")
  }

  const sourceFileName = requiredText(input.sourceFileName.slice(0, 200), "Source file name")
  const sourceSheetName = requiredText(input.sourceSheetName.slice(0, 200), "Source sheet name")
  // Prices every row on the server from its quantity, unit cost and markup.
  const normalizedLines = input.lines.map((line) => {
    const pricing = planSwiftLinePricing(line)
    return {
      ...pricing,
      costCode: requiredText(line.costCode.slice(0, 100), `Cost code on row ${pricing.rowNumber}`),
      description: requiredText(line.description.slice(0, 500), `Description on row ${pricing.rowNumber}`),
      notes: cleanText(line.notes?.slice(0, 5_000) ?? null),
      unit: cleanText(line.unit?.slice(0, 40) ?? null) ?? "LS",
    }
  })

  const sourceCostCodes = [...new Set(normalizedLines.map((line) => line.costCode))]
  const costRows = await loadProjectCostCodeCatalog(access.db)
  const costCodeMap = new Map(costRows.map((row) => [row.code, row]))
  const unknownCostCodes = sourceCostCodes.filter((costCode) => !costCodeMap.has(costCode))
  if (unknownCostCodes.length > 0) {
    const examples = unknownCostCodes.slice(0, 5).join(", ")
    throw new Error(`Map every row to a verified CSI/Sage catalog code before importing. Not found: ${examples}.`)
  }

  const existingRows = await access.db
    .select()
    .from(projectEstimateLines)
    .where(eq(projectEstimateLines.estimateId, estimateId))
  const retainedRows = input.replaceExistingPlanSwiftLines
    ? existingRows.filter((row) => !row.specifications?.includes("PlanSwift source:"))
    : existingRows
  const priorSortOrder = retainedRows.reduce((highest, row) => Math.max(highest, row.sortOrder), 0)
  const now = new Date().toISOString()
  const lineValues = normalizedLines.map((line, index) => {
    const cost = costCodeMap.get(line.costCode)
    if (!cost) throw new Error(`Cost code ${line.costCode} is unavailable.`)
    const sourceNote = `PlanSwift source: ${sourceFileName} · ${sourceSheetName} · row ${line.rowNumber}`
    return {
      id: crypto.randomUUID(),
      projectId,
      estimateId,
      templateLineId: null,
      assemblyId: null,
      reportPhaseId: null,
      divisionCode: cost.divisionCode,
      divisionName: cost.divisionDescription,
      costCode: cost.code,
      costCodeName: cost.description,
      description: line.description,
      specifications: [line.notes, sourceNote].filter(Boolean).join("\n"),
      quantity: line.quantity,
      unit: line.unit,
      unitCostCents: line.unitCostCents,
      directCostCents: line.directCostCents,
      markupRateBasisPoints: line.markupRateBasisPoints,
      markupCents: line.markupCents,
      taxable: false,
      taxEntityId: null,
      taxCode: null,
      taxName: null,
      taxRateBasisPoints: 0,
      taxCents: line.taxCents,
      lineTotalCents: line.lineTotalCents,
      ownerVisible: true,
      includeInBuilderFee: true,
      sortOrder: priorSortOrder + index + 1,
      pricingSource: null,
      pricingTodoId: null,
      createdAt: now,
      updatedAt: now,
    }
  })
  const totals = calculateEstimateTotals(
    [...retainedRows.map(ledgerLine), ...lineValues.map(ledgerLine)],
    {
      overheadRateBasisPoints: estimate.overheadRateBasisPoints,
      marginRateBasisPoints: estimate.marginRateBasisPoints,
      contingencyRateBasisPoints: estimate.contingencyRateBasisPoints,
    }
  )
  const inserts = lineChunks(lineValues, 3).map((chunk) => insertEstimateLineStatement(access.db, chunk))
  const totalsUpdate = updateEstimatesStatement(access.db, eq(projectEstimates.id, estimateId), { ...totals, updatedAt: now })
  const [firstInsert, ...remainingInserts] = inserts
  if (!firstInsert) throw new Error("Select at least one PlanSwift row to import.")
  if (input.replaceExistingPlanSwiftLines) {
    const deletePriorImports = deleteEstimateLinesStatement(
      access.db,
      and(
        eq(projectEstimateLines.estimateId, estimateId),
        like(projectEstimateLines.specifications, "%PlanSwift source:%")
      )
    )
    await access.db.batch([deletePriorImports, firstInsert, ...remainingInserts, totalsUpdate])
  } else {
    await access.db.batch([firstInsert, ...remainingInserts, totalsUpdate])
  }

  return {
    lineCount: lineValues.length,
    totalCents: lineValues.reduce((total, line) => total + line.lineTotalCents, 0),
  }
}

/**
 * Imports a Buildertrend estimate export into a draft estimate: one line per
 * Buildertrend row, report phases from its scope packages (shown as package
 * totals with their descriptions, like the Buildertrend proposal), and the
 * exported amounts kept exactly so a signed estimate matches to the cent.
 */
export async function importBuildertrendExport(
  access: EstimateAccess,
  projectId: string,
  estimate: EstimateRow,
  input: ProjectEstimateBuildertrendImportInput
): Promise<ImportCount> {
  const estimateId = estimate.id
  if (input.lines.length === 0) throw new Error("The Buildertrend export has no rows to import.")
  if (input.lines.length > 2_000) throw new Error("Buildertrend imports are limited to 2,000 rows.")
  const sourceFileName = requiredText(input.sourceFileName.slice(0, 200), "Source file name")
  const phaseNames = new Set(input.phases.map((phase) => phase.name))
  for (const line of input.lines) {
    const integers = [line.unitCostCents, line.directCostCents, line.lineTotalCents, line.markupRateBasisPoints]
    if (integers.some((value) => !Number.isSafeInteger(value) || value < 0) || !Number.isFinite(line.quantity) || line.quantity < 0) {
      throw new Error(`Buildertrend row ${line.rowNumber} has invalid amounts.`)
    }
    if (line.lineTotalCents < line.directCostCents || line.lineTotalCents > 10_000_000_000) {
      throw new Error(`Buildertrend row ${line.rowNumber} has an invalid total.`)
    }
    if (!phaseNames.has(line.phaseName)) throw new Error(`Buildertrend row ${line.rowNumber} has an unknown scope package.`)
  }

  const costRows = await loadProjectCostCodeCatalog(access.db)
  const costCodeMap = new Map(costRows.map((row) => [row.code, row]))
  const unknown = [...new Set(input.lines.map((line) => line.costCode))].filter((code) => !costCodeMap.has(code))
  if (unknown.length > 0) {
    throw new Error(`These Buildertrend cost codes aren't in the Compass cost code catalog: ${unknown.slice(0, 5).join(", ")}.`)
  }

  const existingLines = await access.db
    .select({ id: projectEstimateLines.id })
    .from(projectEstimateLines)
    .where(eq(projectEstimateLines.estimateId, estimateId))
  if (existingLines.length > 0 && !input.replaceExisting) {
    throw new Error("This estimate already has lines. Choose to replace them, or import into a new revision.")
  }

  const now = new Date().toISOString()
  // A phase sorts with the lowest division among its lines.
  const phaseRows = input.phases.map((phase) => {
    const divisions = input.lines
      .filter((line) => line.phaseName === phase.name)
      .map((line) => costCodeMap.get(line.costCode)?.divisionCode ?? "99")
      .sort()
    return {
      id: crypto.randomUUID(),
      projectId,
      estimateId,
      divisionCode: divisions[0] ?? "01",
      name: requiredText(phase.name.slice(0, 160), "Scope package name"),
      description: phase.description.slice(0, 6_000),
      itemize: false,
      sortOrder: Math.max(1, Math.round(phase.sortOrder)),
      createdAt: now,
      updatedAt: now,
    }
  })
  const phaseIdByName = new Map(phaseRows.map((phase) => [phase.name, phase.id]))
  // Buildertrend Parent Groups are the estimate's assemblies too, so the
  // contract budget and pay applications can bill and report by them.
  const assemblyRows = input.phases
    .filter((phase) => phase.fromParentGroup)
    .map((phase) => ({
      id: crypto.randomUUID(),
      estimateId,
      name: requiredText(phase.name.slice(0, 160), "Assembly name"),
      description: cleanText(phase.description.slice(0, 6_000)),
      sortOrder: Math.max(1, Math.round(phase.sortOrder)),
      createdAt: now,
      updatedAt: now,
    }))
  const assemblyIdByName = new Map(assemblyRows.map((assembly) => [assembly.name, assembly.id]))
  const lineValues = input.lines.map((line, index) => {
    const cost = costCodeMap.get(line.costCode)
    if (!cost) throw new Error(`Cost code ${line.costCode} is unavailable.`)
    const sourceNote = `Buildertrend source: ${sourceFileName} · row ${line.rowNumber}${line.costType ? ` · ${line.costType}` : ""}`
    return {
      id: crypto.randomUUID(),
      projectId,
      estimateId,
      templateLineId: null,
      assemblyId: assemblyIdByName.get(line.phaseName.slice(0, 160)) ?? null,
      reportPhaseId: phaseIdByName.get(line.phaseName) ?? null,
      divisionCode: cost.divisionCode,
      divisionName: cost.divisionDescription,
      costCode: cost.code,
      costCodeName: cost.description,
      description: requiredText(line.description.slice(0, 500), `Title on row ${line.rowNumber}`),
      specifications: [cleanText(line.notes?.slice(0, 5_000) ?? null), sourceNote].filter(Boolean).join("\n"),
      quantity: line.quantity,
      unit: cleanText(line.unit.slice(0, 40)) ?? "LS",
      unitCostCents: line.unitCostCents,
      // Exported amounts are kept as-is so the total matches the signed estimate.
      directCostCents: line.directCostCents,
      markupRateBasisPoints: line.markupRateBasisPoints,
      markupCents: line.lineTotalCents - line.directCostCents,
      taxable: false,
      taxEntityId: null,
      taxCode: null,
      taxName: null,
      taxRateBasisPoints: 0,
      taxCents: 0,
      lineTotalCents: line.lineTotalCents,
      ownerVisible: true,
      includeInBuilderFee: true,
      pricingSource: null,
      pricingTodoId: null,
      sortOrder: index + 1,
      createdAt: now,
      updatedAt: now,
    }
  })
  const totals = calculateEstimateTotals(lineValues.map(ledgerLine), {
    overheadRateBasisPoints: estimate.overheadRateBasisPoints,
    marginRateBasisPoints: estimate.marginRateBasisPoints,
    contingencyRateBasisPoints: estimate.contingencyRateBasisPoints,
  })
  // Fixed chunk sizes keep each insert under D1's bound-parameter limit.
  await access.db.batch([
    deleteEstimateLinesStatement(access.db, eq(projectEstimateLines.estimateId, estimateId)),
    deleteEstimateReportPhasesStatement(access.db, eq(projectEstimateReportPhases.estimateId, estimateId)),
    deleteEstimateAssembliesStatement(access.db, eq(projectEstimateAssemblies.estimateId, estimateId)),
    ...lineChunks(assemblyRows, 12).map((chunk) => insertEstimateAssemblyStatement(access.db, chunk)),
    ...lineChunks(phaseRows, 8).map((chunk) => insertEstimateReportPhaseStatement(access.db, chunk)),
    ...lineChunks(lineValues, 3).map((chunk) => insertEstimateLineStatement(access.db, chunk)),
    updateEstimatesStatement(access.db, eq(projectEstimates.id, estimateId), { ...totals, updatedAt: now }),
  ])

  return {
    lineCount: lineValues.length,
    totalCents: lineValues.reduce((total, line) => total + line.lineTotalCents, 0),
  }
}
