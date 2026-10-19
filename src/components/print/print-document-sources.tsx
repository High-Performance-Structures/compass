import type * as React from "react"

import { getProjectChangeOrder } from "@/app/actions/project-change-orders"
import { getProjectRfqs } from "@/app/actions/project-operations"
import { PrintSourceMode } from "@/components/print/print-source-mode"
import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { changeOrderCopyData } from "@/lib/paper-trail/record-copy-data"
import { changeOrderReport } from "@/lib/print/audience-record-reports"
import { printProjectAccess } from "@/lib/print/print-access"
import type { PrintDocument } from "@/lib/print/print-documents"
import { portalReportHtml, type PortalReport, type ReportProject } from "@/lib/print/portal-report"
import { rfqLink, rfqPrintHtml } from "@/lib/print/rfq-print"
import { projectBrandFor } from "@/lib/project-branding"
import { projectNumberAndName } from "@/lib/project-display-name"

type Query = Readonly<Record<string, string | undefined>>

async function portalReportSource(project: ReportProject, report: PortalReport): Promise<React.ReactElement> {
  return (
    <>
      <article
        data-selection-print-root="true"
        className="selection-printable portal-report-printable"
        // portalReportHtml escapes every value.
        dangerouslySetInnerHTML={{ __html: portalReportHtml(project, report, false, undefined, await currentDepartmentProfiles()) }}
      />
      <PrintSourceMode bodyClass="selection-printing-selected" />
    </>
  )
}

async function changeOrderSource(projectId: string, query: Query): Promise<React.ReactElement | null> {
  const changeOrderId = query.changeOrderId
  if (!changeOrderId) return null
  // The staff change order read checks access before the record is loaded.
  const item = await getProjectChangeOrder(projectId, changeOrderId)
  if (!item) return null
  const { db } = await printProjectAccess(projectId)
  const data = await changeOrderCopyData(db, projectId, changeOrderId)
  return data ? portalReportSource(data.project, changeOrderReport([data.changeOrder])) : null
}

async function rfqSource(projectId: string, query: Query, origin: string): Promise<React.ReactElement | null> {
  const rfq = (await getProjectRfqs(projectId)).find((item) => item.id === query.rfqId)
  if (!rfq) return null
  const { project } = await printProjectAccess(projectId)
  const brand = projectBrandFor({
    profiles: await currentDepartmentProfiles(),
    department: project.department,
    projectId,
    projectNumber: project.projectNumber,
  })
  const projectLabel = project.projectNumber ? projectNumberAndName(project, " - ") : project.name
  return (
    <>
      <article
        data-rfq-print-root="true"
        // rfqPrintHtml escapes every value.
        dangerouslySetInnerHTML={{
          __html: rfqPrintHtml({ brand, projectLabel, rfq, url: new URL(rfqLink(projectId, rfq.id), origin).toString() }),
        }}
      />
      <PrintSourceMode bodyClass="rfq-printing-selected" />
    </>
  )
}

/** The print-only markup for a document, or null when it isn't found. */
export async function printDocumentSource(
  projectId: string,
  document: PrintDocument,
  query: Query,
  origin: string
): Promise<React.ReactElement | null> {
  switch (document) {
    case "change-order":
      return changeOrderSource(projectId, query)
    case "rfq":
      return rfqSource(projectId, query, origin)
    case "purchase-order":
    case "shop-ticket":
      return null
  }
}
