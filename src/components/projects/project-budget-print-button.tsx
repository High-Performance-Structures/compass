"use client"

import * as React from "react"
import { IconEye } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { openPrintSnapshot } from "@/lib/print/open-print-snapshot"

/** Print Preview for the G703 budget exactly as shown on this page. */
export function ProjectBudgetPrintButton({
  projectId,
  documentNumber,
}: {
  readonly projectId: string
  readonly documentNumber: string
}): React.ReactElement {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function preview(): Promise<void> {
    const source = document.querySelector('[data-project-budget-print-source="true"]')
    if (!(source instanceof HTMLElement)) {
      setError("There is nothing to print yet.")
      return
    }
    setError(null)
    setPending(true)
    const result = await openPrintSnapshot({
      projectId,
      kind: "budget",
      title: "Budget G703",
      documentNumber: `${documentNumber} G703`,
      html: source.innerHTML,
    })
    setPending(false)
    if (!result.success) setError(result.error)
  }

  return (
    <div>
      <Button type="button" size="sm" disabled={pending} onClick={() => void preview()}>
        <IconEye className="size-4" />
        {pending ? "Preparing preview…" : "Print Preview"}
      </Button>
      {error && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
