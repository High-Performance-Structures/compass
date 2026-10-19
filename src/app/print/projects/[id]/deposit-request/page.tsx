export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { PrintSourceMode } from "@/components/print/print-source-mode"
import { DepositRequestDocument } from "@/components/projects/deposit-request-document"
import { DocumentReportActions } from "@/components/projects/document-report-actions"
import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { depositRequestDocument } from "@/lib/deposits/deposit-requests"
import { printProjectAccess } from "@/lib/print/print-access"
import { printPdfHref } from "@/lib/print/print-documents"
import { projectBrandFor } from "@/lib/project-branding"
import { requireProjectRouteId } from "@/lib/project-route-id"

export default async function DepositRequestPrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ depositId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const projectId = await requireProjectRouteId(rawProjectId)
  const depositId = query.depositId
  if (!depositId) notFound()
  // Staff and the project's clients can open a deposit request.
  const { db, project } = await printProjectAccess(projectId)
  const request = await depositRequestDocument(db, projectId, depositId)
  if (!request) notFound()
  const brand = projectBrandFor({
    profiles: await currentDepartmentProfiles(),
    department: project.department,
    projectId,
    projectNumber: project.projectNumber,
  })
  return (
    <>
      <DocumentReportActions
        title="Deposit request"
        documentNumber={request.number}
        pdfHref={printPdfHref({ projectId, document: "deposit-request", params: { depositId }, number: request.number })}
      />
      <main className="mx-auto my-4 max-w-[8.5in] border bg-report-paper p-8 text-xs leading-tight text-report-ink print:my-0 print:max-w-none print:border-0 print:p-0">
        <style>{"@page { size: letter; margin: 0.5in; } @media print { body { background: white !important; } }"}</style>
        <DepositRequestDocument brand={brand} request={request} />
        <PrintSourceMode />
      </main>
    </>
  )
}
