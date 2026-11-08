export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { getPayRequestSageBillingCheck } from "@/app/actions/sage-billing-check"
import { SageBillingChecklistDocument } from "@/components/financials/sage-billing-check"
import { PrintSourceMode } from "@/components/print/print-source-mode"
import { DocumentReportActions } from "@/components/projects/document-report-actions"
import { printPdfHref } from "@/lib/print/print-documents"
import { requireProjectRouteId } from "@/lib/project-route-id"

/** Print Preview of a pay request's "Enter in Sage" checklist (internal; office staff with finance access). */
export default async function SageBillingChecklistPrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ applicationId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const projectId = await requireProjectRouteId(rawProjectId)
  const applicationId = query.applicationId
  if (!applicationId) notFound()
  const result = await getPayRequestSageBillingCheck(projectId, applicationId)
  if (!result.success) notFound()
  const view = result.data
  const number = `Enter in Sage ${view.applicationNumber}`
  return (
    <>
      <DocumentReportActions
        title="Enter in Sage"
        documentNumber={number}
        emailLink={false}
        pdfHref={printPdfHref({ projectId, document: "sage-billing-checklist", params: { applicationId }, number })}
      />
      <main className="mx-auto my-4 max-w-[11in] border bg-report-paper p-8 text-xs leading-tight text-report-ink print:my-0 print:max-w-none print:border-0 print:p-0">
        <style>{"@page { size: letter landscape; margin: 0.4in; } @media print { body { background: white !important; } }"}</style>
        <header className="mb-4">
          <h1 className="text-lg font-semibold">Enter in Sage: pay application {view.applicationNumber}</h1>
          <p className="text-sm">Type these into Sage&apos;s progress billing, then post it.</p>
        </header>
        <SageBillingChecklistDocument view={view} />
        <PrintSourceMode />
      </main>
    </>
  )
}
