/**
 * One purchase order's record on its job's purchase order page: the list
 * opens that PO's details below it. `status` is the list filter to show
 * ("all" so the PO is listed whatever its status).
 */
export function purchaseOrderRecordHref(projectId: string, purchaseOrderId: string, status = "all"): string {
  const project = encodeURIComponent(projectId)
  const item = encodeURIComponent(purchaseOrderId)
  return `/dashboard/projects/${project}/purchase-orders?status=${encodeURIComponent(status)}&item=${item}#purchase-order-${item}`
}
