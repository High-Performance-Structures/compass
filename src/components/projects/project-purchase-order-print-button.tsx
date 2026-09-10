"use client"

import { IconPrinter } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { requiresSynchronousPrint } from "@/lib/print/ios-print"
import {
  IOS_PRINT_STATE_TIMEOUT_MS,
  PRINT_STATE_TIMEOUT_MS,
  waitForPrintLayout,
} from "@/lib/print/readiness"

export function ProjectPurchaseOrderPrintButton({
  purchaseOrderId,
}: {
  readonly purchaseOrderId: string
}): React.ReactElement {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => printProjectPurchaseOrder(purchaseOrderId)}
      className="print:hidden"
    >
      <IconPrinter className="size-4" />
      Pickup copy
    </Button>
  )
}

export async function printProjectPurchaseOrder(
  purchaseOrderId: string
): Promise<void> {
  const selected = document.querySelector(`[data-po-id="${purchaseOrderId}"]`)
  if (!(selected instanceof HTMLElement)) {
    window.print()
    return
  }

  // Print a body-level copy in normal document flow. Printing the live card in
  // its nested app shell (or absolutely positioning it) prevents long POs from
  // fragmenting across pages in Safari and Chromium.
  const printRoot = selected.cloneNode(true)
  if (!(printRoot instanceof HTMLElement)) {
    window.print()
    return
  }

  printRoot.setAttribute("data-purchase-order-print-root", "true")
  printRoot.classList.add("purchase-order-print-root")
  document.body.classList.add("po-printing-selected")
  document.body.appendChild(printRoot)

  const resetPrintState = (): void => {
    printRoot.remove()
    document.body.classList.remove("po-printing-selected")
    window.removeEventListener("afterprint", resetPrintState)
  }

  if (requiresSynchronousPrint(window.navigator)) {
    window.print()
    window.setTimeout(resetPrintState, IOS_PRINT_STATE_TIMEOUT_MS)
    return
  }

  window.addEventListener("afterprint", resetPrintState)
  await waitForPrintLayout(printRoot)
  window.print()
  window.setTimeout(resetPrintState, PRINT_STATE_TIMEOUT_MS)
}
