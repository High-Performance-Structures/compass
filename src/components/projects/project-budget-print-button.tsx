"use client"

import type * as React from "react"
import { IconPrinter } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"

const PRINT_IMAGE_TIMEOUT_MS = 3_000

async function waitForImage(image: HTMLImageElement): Promise<void> {
  if (image.complete) return

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      image.removeEventListener("load", finish)
      image.removeEventListener("error", finish)
      resolve()
    }
    const timeoutId = window.setTimeout(finish, PRINT_IMAGE_TIMEOUT_MS)
    image.addEventListener("load", finish, { once: true })
    image.addEventListener("error", finish, { once: true })
  })
}

export function ProjectBudgetPrintButton(): React.ReactElement {
  async function printBudget(): Promise<void> {
    const selected = document.querySelector(
      '[data-owner-budget-print-source="true"]'
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

    printRoot.setAttribute("data-owner-budget-print-root", "true")
    printRoot.classList.add("owner-budget-print-root")
    document.body.classList.add("owner-budget-printing")
    document.body.appendChild(printRoot)

    const resetPrintState = (): void => {
      printRoot.remove()
      document.body.classList.remove("owner-budget-printing")
      window.removeEventListener("afterprint", resetPrintState)
    }

    window.addEventListener("afterprint", resetPrintState)
    await Promise.all(
      Array.from(printRoot.querySelectorAll("img")).map(waitForImage)
    )
    await document.fonts.ready
    window.print()
    window.setTimeout(resetPrintState, 5_000)
  }

  return (
    <Button type="button" size="sm" onClick={printBudget}>
      <IconPrinter className="size-4" />
      Print / Save G703
    </Button>
  )
}
