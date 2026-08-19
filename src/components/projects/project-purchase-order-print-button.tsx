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
  async function printPurchaseOrder(): Promise<void> {
    const selected = document.querySelector(
      `[data-po-id="${purchaseOrderId}"]`
    )
    if (!(selected instanceof HTMLElement)) {
      window.print()
      return
    }

    document.body.classList.add("po-printing-selected")
    selected.setAttribute("data-print-selected", "true")

    const resetPrintState = (): void => {
      selected.removeAttribute("data-print-selected")
      document.body.classList.remove("po-printing-selected")
      window.removeEventListener("afterprint", resetPrintState)
    }

    if (requiresSynchronousPrint(window.navigator)) {
      window.print()
      window.setTimeout(resetPrintState, IOS_PRINT_STATE_TIMEOUT_MS)
      return
    }

    window.addEventListener("afterprint", resetPrintState)
    await waitForPrintLayout(selected)
    window.print()
    window.setTimeout(resetPrintState, PRINT_STATE_TIMEOUT_MS)
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={printPurchaseOrder}
      className="print:hidden"
    >
      <IconPrinter className="size-4" />
      Pickup copy
    </Button>
  )
}
