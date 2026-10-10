import { asc, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { projects } from "@/db/schema"
import { projectEstimateLines, projectEstimates } from "@/db/schema-estimates"
import { projectBrandFor } from "@/lib/project-branding"
import { projectNumberAndName } from "@/lib/project-display-name"
import { statusLabel } from "@/lib/project-operations/status"
import type { LoadedPaperTrailRecord } from "@/lib/paper-trail/types"

function money(cents: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents ?? 0) / 100)
}

function percent(basisPoints: number | null | undefined): string {
  return `${((basisPoints ?? 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`
}

/**
 * The full internal estimate, including cost and markup: these copies live in
 * the private Estimate folder and exist so the estimate can be rebuilt.
 */
export async function loadEstimateRecord(
  db: ReturnType<typeof getDb>,
  recordId: string,
): Promise<LoadedPaperTrailRecord | null> {
  const [row] = await db
    .select({ estimate: projectEstimates, project: { name: projects.name, projectNumber: projects.projectNumber } })
    .from(projectEstimates)
    .innerJoin(projects, eq(projects.id, projectEstimates.projectId))
    .where(eq(projectEstimates.id, recordId))
    .limit(1)
  if (!row) return null
  const { estimate, project } = row
  const lines = await db
    .select()
    .from(projectEstimateLines)
    .where(eq(projectEstimateLines.estimateId, recordId))
    .orderBy(asc(projectEstimateLines.divisionCode), asc(projectEstimateLines.sortOrder))

  const brand = projectBrandFor({ projectId: estimate.projectId, projectNumber: project.projectNumber })
  const number = [estimate.estimateNumber, `v${estimate.versionNumber}`].filter(Boolean).join(" ")
  const accepted = estimate.signedAt ?? estimate.acceptedAt

  return {
    projectId: estimate.projectId,
    version: [estimate.updatedAt, lines.length, ...lines.map((line) => line.updatedAt)].join("|"),
    fileBaseName: `Estimate ${number}${estimate.title ? ` - ${estimate.title}` : ""}`,
    sheet: {
      companyName: brand.companyName,
      companyLines: brand.contactLines,
      recordLabel: "Estimate",
      title: `Estimate ${number}`,
      projectLabel: projectNumberAndName(project),
      status: statusLabel(estimate.status),
      sections: [
        {
          kind: "fields",
          heading: "Estimate",
          fields: [
            ["Title", estimate.title],
            ["Estimate date", estimate.estimateDate],
            ["Client", estimate.clientName],
            ["Client address", estimate.clientMailingAddress],
            ["Client signer", estimate.clientSignerName],
            ["Company signer", estimate.companySignerName],
            ["Signed or accepted", accepted],
            ["Acceptance method", estimate.acceptanceMethod],
          ],
        },
        {
          kind: "fields",
          heading: "Totals",
          fields: [
            ["Direct cost", money(estimate.directCostCents)],
            ["Line markup", money(estimate.markupCents)],
            ["Tax", money(estimate.taxCents)],
            [`Overhead (${percent(estimate.overheadRateBasisPoints)})`, money(estimate.overheadCents)],
            [`Margin (${percent(estimate.marginRateBasisPoints)})`, money(estimate.marginCents)],
            [`Contingency (${percent(estimate.contingencyRateBasisPoints)})`, money(estimate.contingencyCents)],
            ["Builder fee", money(estimate.builderFeeCents)],
            ["Estimate total", money(estimate.estimateTotalCents)],
          ],
        },
        {
          kind: "table",
          heading: "Lines",
          columns: [
            { label: "Division" },
            { label: "Description" },
            { label: "Cost code" },
            { label: "Qty", align: "right" },
            { label: "Unit" },
            { label: "Unit cost", align: "right" },
            { label: "Direct", align: "right" },
            { label: "Markup", align: "right" },
            { label: "Total", align: "right" },
          ],
          rows: lines.map((line) => [
            [line.divisionCode, line.divisionName].filter(Boolean).join(" "),
            [line.description, line.specifications].filter(Boolean).join(" — "),
            line.costCode ?? "",
            line.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 }),
            line.unit ?? "",
            money(line.unitCostCents),
            money(line.directCostCents),
            money(line.markupCents),
            money(line.lineTotalCents),
          ]),
          footer: ["", "Estimate total", "", "", "", "", money(estimate.directCostCents), money(estimate.markupCents), money(estimate.estimateTotalCents)],
        },
        { kind: "text", heading: "Introduction", body: estimate.introductionText },
        { kind: "text", heading: "Contract terms", body: estimate.contractTerms },
        { kind: "text", heading: "Closing", body: estimate.closingText },
      ],
    },
  }
}
