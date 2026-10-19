import type * as React from "react"

import { getProjectChangeOrder } from "@/app/actions/project-change-orders"
import { getOwnerProjectUpdateDocument, getProjectDailyLogWorkspace } from "@/app/actions/project-field"
import { getProjectRfqs } from "@/app/actions/project-operations"
import { DepartmentProfilesProvider } from "@/components/branding/department-profiles-provider"
import { PrintSourceMode } from "@/components/print/print-source-mode"
import { DailyLogPrintDocument } from "@/components/projects/daily-log-print-document"
import { OwnerUpdatePrintable, ownerUpdateProjectLabel } from "@/components/projects/owner-update-document"
import { ALL_DAILY_LOG_AUTHORS, matchesDailyLogPrintFilters } from "@/lib/daily-logs/print-selection"
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

async function ownerUpdateSource(projectId: string, query: Query): Promise<React.ReactElement | null> {
  if (!query.updateId) return null
  // The owner update read checks the viewer's access, staff or client.
  const document = await getOwnerProjectUpdateDocument(projectId, query.updateId).catch(() => null)
  if (!document) return null
  const brand = projectBrandFor({
    projectId: document.project.id,
    projectNumber: document.project.projectNumber,
    profiles: await currentDepartmentProfiles(),
  })
  return (
    <>
      <OwnerUpdatePrintable document={document} brand={brand} label={ownerUpdateProjectLabel(document)} printRoot />
      <PrintSourceMode bodyClass="owner-update-printing-selected" />
    </>
  )
}

async function dailyLogsSource(projectId: string, query: Query): Promise<React.ReactElement | null> {
  const workspace = await getProjectDailyLogWorkspace(projectId)
  const ids = query.logIds ? new Set(query.logIds.split(",")) : null
  const logs = workspace.logs.filter((log) =>
    ids
      ? ids.has(log.id)
      : matchesDailyLogPrintFilters(log, query.start ?? "", query.end ?? "", query.author ?? ALL_DAILY_LOG_AUTHORS)
  )
  if (logs.length === 0) return null
  const { project } = workspace
  return (
    <DepartmentProfilesProvider profiles={await currentDepartmentProfiles()}>
      <DailyLogPrintDocument
        clientName={project.clientName}
        logs={logs}
        projectId={project.id}
        projectLabel={project.projectNumber ?? project.name}
        projectName={project.name}
        projectNumber={project.projectNumber}
      />
      <PrintSourceMode bodyClass="daily-log-printing" />
    </DepartmentProfilesProvider>
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
    case "owner-update":
      return ownerUpdateSource(projectId, query)
    case "daily-logs":
      return dailyLogsSource(projectId, query)
    case "purchase-order":
    case "shop-ticket":
    case "estimate-compare":
      return null
  }
}
