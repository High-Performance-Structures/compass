"use client"

import { IconPrinter } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { printAfterDomUpdate } from "@/lib/browser-print"

export function ProjectPurchaseOrderPrintButton({
  purchaseOrderId,
}: {
  readonly purchaseOrderId: string
}): React.ReactElement {
  function printPurchaseOrder(): void {
    const selected = document.querySelector(
      `[data-po-id="${purchaseOrderId}"]`
    )
    if (!(selected instanceof HTMLElement)) {
      window.print()
      return
    }

    document.body.classList.add("po-printing-selected")
    selected.setAttribute("data-print-selected", "true")

    printAfterDomUpdate(() => {
      selected.removeAttribute("data-print-selected")
      document.body.classList.remove("po-printing-selected")
    }, 1000)
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
