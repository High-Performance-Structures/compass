import type {
  CreatePurchaseOrderRequestInput,
  ProjectPurchaseOrderItem,
  UpdatePurchaseOrderRequestInput,
} from "@/app/actions/project-operations"

export function buildPurchaseOrderUpdateInput(
  request: CreatePurchaseOrderRequestInput,
  purchaseOrder: Pick<ProjectPurchaseOrderItem, "revision">
): UpdatePurchaseOrderRequestInput {
  return {
    ...request,
    expectedRevision: purchaseOrder.revision,
  }
}
