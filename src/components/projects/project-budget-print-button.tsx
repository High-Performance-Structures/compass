"use client"

import type * as React from "react"
import { IconPrinter } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { requiresSynchronousPrint } from "@/lib/print/ios-print"
import {
  IOS_PRINT_STATE_TIMEOUT_MS,
  PRINT_STATE_TIMEOUT_MS,
  waitForPrintLayout,
} from "@/lib/print/readiness"

export function ProjectBudgetPrintButton(): React.ReactElement {
  async function printBudget(): Promise<void> {
    const selected = document.querySelector(
      '[data-project-budget-print-source="true"]'
    )
    if (!(selected instanceof HTMLElement)) {
      window.print()
      return
    }

    const printRoot = selected.cloneNode(true)
    if (!(printRoot instanceof HTMLElement)) {
      window.print()
      return
    }

    printRoot.setAttribute("data-project-budget-print-root", "true")
    printRoot.classList.add("owner-budget-print-root")
    document.body.classList.add("owner-budget-printing")
    document.body.appendChild(printRoot)

    const resetPrintState = (): void => {
      printRoot.remove()
      document.body.classList.remove("owner-budget-printing")
      window.removeEventListener("afterprint", resetPrintState)
    }

    if (requiresSynchronousPrint(window.navigator)) {
      // iPad Safari drops the tap's user activation after the first await,
      // causing window.print() to be ignored entirely. Its print sheet also
      // renders asynchronously, so keep the isolated document alive while the
      // preview is generated instead of relying on afterprint or a short timer.
      window.print()
      window.setTimeout(resetPrintState, IOS_PRINT_STATE_TIMEOUT_MS)
      return
    }

    window.addEventListener("afterprint", resetPrintState)
    await waitForPrintLayout(printRoot)
    window.print()
    window.setTimeout(resetPrintState, PRINT_STATE_TIMEOUT_MS)
  }

  return (
    <Button type="button" size="sm" onClick={printBudget}>
      <IconPrinter className="size-4" />
      Print / Save G703
    </Button>
  )
}
