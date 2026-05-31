"use client"

import { IconPrinter } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"

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

    const resetPrintState = (): void => {
      selected.removeAttribute("data-print-selected")
      document.body.classList.remove("po-printing-selected")
      window.removeEventListener("afterprint", resetPrintState)
    }

    window.addEventListener("afterprint", resetPrintState)
    window.print()
    window.setTimeout(resetPrintState, 1000)
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
