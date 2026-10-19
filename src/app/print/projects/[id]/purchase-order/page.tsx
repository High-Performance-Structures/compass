export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"
import { PrintSourceMode } from "@/components/print/print-source-mode"

import { getProjectPurchaseOrders } from "@/app/actions/project-operations"
import { DocumentReportActions } from "@/components/projects/document-report-actions"
import { PurchaseOrderDocument } from "@/components/projects/purchase-order-document"
import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { purchaseOrderCopyData } from "@/lib/paper-trail/record-copy-data"
import { printProjectAccess } from "@/lib/print/print-access"
import { printPdfHref } from "@/lib/print/print-documents"
import { projectBrandFor } from "@/lib/project-branding"
import { requireProjectRouteId } from "@/lib/project-route-id"

export default async function PurchaseOrderPrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ purchaseOrderId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const projectId = await requireProjectRouteId(rawProjectId)
  const purchaseOrderId = query.purchaseOrderId
  // The purchase order list checks the viewer's access before anything loads.
  const order = purchaseOrderId
    ? (await getProjectPurchaseOrders(projectId)).find((item) => item.id === purchaseOrderId)
    : undefined
  if (!order || !purchaseOrderId) notFound()
  const { db, project } = await printProjectAccess(projectId)
  const data = await purchaseOrderCopyData(db, projectId, purchaseOrderId)
  if (!data) notFound()
  const brand = projectBrandFor({
    profiles: await currentDepartmentProfiles(),
    department: project.department,
    projectId,
    projectNumber: data.projectNumber,
  })
  const number = data.order.sourceRecordNumber ?? "Purchase order"
  return (
    <>
      <DocumentReportActions
        title="Purchase order"
        documentNumber={number}
        pdfHref={printPdfHref({ projectId, document: "purchase-order", params: { purchaseOrderId }, number })}
      />
      <main className="mx-auto my-4 max-w-[8.5in] border bg-white p-8 text-[11px] leading-tight text-black print:my-0 print:max-w-none print:border-0 print:p-0">
        <style>{"@page { size: letter; margin: 0.5in; } @media print { body { background: white !important; } }"}</style>
        <PurchaseOrderDocument
          brand={brand}
          order={data.order}
          projectLabel={data.projectLabel}
          deliveryLocation={data.deliveryLocation}
        />
        <PrintSourceMode />
      </main>
    </>
  )
}
