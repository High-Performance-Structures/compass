import type { PublishSelectionInput } from "@/app/actions/selection-decisions"
import type { SelectionDecisionItem } from "./types"

/** Publish the reviewed values without inventing pricing or owner approval. */
export function selectionPublicationInput(
  item: SelectionDecisionItem,
): PublishSelectionInput {
  return {
    selectionId: item.id,
    expectedRevision: item.revision,
    selectionUpdatedAt: item.selectionUpdatedAt,
    published: true,
    decisionDueDate: item.decisionDueDate ?? "",
    allowance:
      item.allowanceCents === null
        ? ""
        : (item.allowanceCents / 100).toFixed(2),
    price: item.quotedCents === null ? "" : (item.quotedCents / 100).toFixed(2),
    scheduleImpact: item.scheduleImpact ?? "",
    ownerNote: item.ownerNote ?? "",
    requiresChangeOrder: item.requiresChangeOrder,
    changeOrderId: item.changeOrderId ?? "",
  }
}
