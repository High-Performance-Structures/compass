export type PurchaseOrderDraftState = {
  readonly sourceSystem: string
  readonly status: string
  readonly syncStatus: string
  readonly sageWriteStatus: string
}

export function canEditPurchaseOrderDraft(
  purchaseOrder: PurchaseOrderDraftState
): boolean {
  return (
    purchaseOrder.sourceSystem === "compass" &&
    purchaseOrder.status === "draft" &&
    purchaseOrder.sageWriteStatus === "draft_ready" &&
    !["queued_sage", "syncing", "synced"].includes(
      purchaseOrder.syncStatus
    )
  )
}

export function canRemovePurchaseOrderLine(
  lineCount: number,
  isExistingPurchaseOrder: boolean
): boolean {
  return lineCount > 1 || isExistingPurchaseOrder
}
