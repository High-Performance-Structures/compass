export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"

import { InvoiceDocument } from "@/components/financials/invoice-document"
import { PrintSourceMode } from "@/components/print/print-source-mode"
import { DocumentReportActions } from "@/components/projects/document-report-actions"
import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { loadSimpleInvoiceDocument } from "@/lib/financials/simple-invoice-document"
import { printProjectAccess } from "@/lib/print/print-access"
import { printPdfHref } from "@/lib/print/print-documents"
import { projectBrandFor } from "@/lib/project-branding"
import { requireProjectRouteId } from "@/lib/project-route-id"

export default async function InvoicePrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ invoiceId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const projectId = await requireProjectRouteId(rawProjectId)
  const invoiceId = query.invoiceId
  if (!invoiceId) notFound()
  const { db, project } = await printProjectAccess(projectId)
  const invoice = await loadSimpleInvoiceDocument(db, projectId, invoiceId)
  if (!invoice) notFound()
  const brand = projectBrandFor({
    profiles: await currentDepartmentProfiles(),
    department: project.department,
    projectId,
    projectNumber: project.projectNumber,
  })
  const number = invoice.invoiceNumber ?? "Draft invoice"
  return (
    <>
      <DocumentReportActions title="Invoice" documentNumber={number} pdfHref={printPdfHref({ projectId, document: "invoice", params: { invoiceId }, number })} emailLink={false} />
      <main className="mx-auto my-4 max-w-[8.5in] border bg-report-paper p-8 text-xs leading-tight text-report-ink print:my-0 print:max-w-none print:border-0 print:p-0">
        <style>{"@page { size: letter; margin: 0.5in; } @media print { body { background: white !important; } }"}</style>
        <InvoiceDocument brand={brand} invoice={invoice} />
        <PrintSourceMode />
      </main>
    </>
  )
}
