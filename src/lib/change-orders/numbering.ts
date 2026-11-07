import { projectChangeOrders } from "@/db/schema"
import { nextChangeOrderNumber } from "@/lib/domain/estimates/variance-rules"

/** The columns numbering reads from the project's change-order rows. */
export const changeOrderNumberColumns = {
  changeOrderNumber: projectChangeOrders.changeOrderNumber,
  formerChangeOrderNumber: projectChangeOrders.formerChangeOrderNumber,
  recordType: projectChangeOrders.recordType,
}

/** The next change-order number on a job: <project number>-CO-001 and up, never reusing one (variances excluded). */
export function changeOrderNumber(
  projectNumber: string | null,
  records: readonly { readonly changeOrderNumber: string; readonly formerChangeOrderNumber: string | null; readonly recordType: string }[]
): string {
  return nextChangeOrderNumber(projectNumber, records)
}
