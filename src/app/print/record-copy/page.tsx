export const dynamic = "force-dynamic"

import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { getEstimateWorkspaceForRecordCopy } from "@/app/actions/project-estimates"
import { EstimateClientReport } from "@/components/projects/estimate-client-report"
import { PurchaseOrderDocument } from "@/components/projects/purchase-order-document"
import { getDb } from "@/db"
import { getCloudflareContext } from "@/lib/db"
import { changeOrderCopyData, purchaseOrderCopyData, rfiCopyData } from "@/lib/paper-trail/record-copy-data"
import { RECORD_COPY_TOKEN_HEADER, verifyRecordCopyToken } from "@/lib/paper-trail/print-token"
import { changeOrderReport, rfiReport } from "@/lib/print/audience-record-reports"
import { portalReportHtml } from "@/lib/print/portal-report"
import { projectBrandFor, projectLegalEntityName } from "@/lib/project-branding"
import { RecordCopyPrintMode } from "./body-print-mode"

/**
 * The project paper trail's print page. The PDF renderer opens it with a
 * single-record pass in a request header; without a valid pass it is a 404.
 * Each record is shown in the same format Compass already prints for it.
 */
export default async function RecordCopyPage(): Promise<React.ReactElement> {
  const token = (await headers()).get(RECORD_COPY_TOKEN_HEADER)
  const { env } = await getCloudflareContext()
  const grant = await verifyRecordCopyToken(env, token)
  if (!grant || !token) notFound()
  const db = getDb(env.DB)

  if (grant.recordType === "purchase_order") {
    const data = await purchaseOrderCopyData(db, grant.projectId, grant.recordId)
    if (!data) notFound()
    const brand = projectBrandFor({ profiles: await currentDepartmentProfiles(), projectId: grant.projectId, projectNumber: data.projectNumber })
    return (
      <main className="bg-white p-0 text-[11px] leading-tight text-black">
        <style>{"@page { size: letter; margin: 0.5in; } @media print { body { background: white !important; } }"}</style>
        <PurchaseOrderDocument
          brand={brand}
          order={data.order}
          projectLabel={data.projectLabel}
          deliveryLocation={data.deliveryLocation}
        />
        <RecordCopyPrintMode selectionReport={false} />
      </main>
    )
  }

  if (grant.recordType === "estimate") {
    const workspace = await getEstimateWorkspaceForRecordCopy(token)
    const estimate = workspace?.activeEstimate
    if (!workspace || !estimate) notFound()
    const brand = projectBrandFor({ profiles: await currentDepartmentProfiles(), projectId: grant.projectId, projectNumber: workspace.projectNumber })
    return (
      <>
        <EstimateClientReport
          id={grant.projectId}
          workspace={workspace}
          estimate={estimate}
          brand={brand}
          legalEntityName={projectLegalEntityName(brand.department, await currentDepartmentProfiles())}
          showActions={false}
        />
        <RecordCopyPrintMode selectionReport={false} />
      </>
    )
  }

  const report =
    grant.recordType === "rfi"
      ? await rfiCopyData(db, grant.projectId, grant.recordId).then((data) =>
          data ? { project: data.project, report: rfiReport([data.rfi]) } : null,
        )
      : await changeOrderCopyData(db, grant.projectId, grant.recordId).then((data) =>
          data ? { project: data.project, report: changeOrderReport([data.changeOrder]) } : null,
        )
  if (!report) notFound()
  return (
    <>
      <article
        data-selection-print-root="true"
        className="selection-printable portal-report-printable"
        // portalReportHtml escapes every value; it is the same markup the
        // in-app "Print / Save PDF" button prints.
        dangerouslySetInnerHTML={{ __html: portalReportHtml(report.project, report.report, false, undefined, await currentDepartmentProfiles()) }}
      />
      <RecordCopyPrintMode selectionReport />
    </>
  )
}
