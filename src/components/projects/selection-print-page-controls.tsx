"use client"

import * as React from "react"
import Link from "next/link"

export function SelectionPrintPageControls({
  backHref,
}: {
  readonly backHref: string
}): React.ReactElement {
  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      window.focus()
      window.print()
    }, 450)

    return () => window.clearTimeout(timeout)
  }, [])

  return (
    <div className="print-help">
      <button type="button" onClick={() => window.print()}>
        Print / Save PDF
      </button>
      <Link href={backHref}>Back to selections</Link>
    </div>
  )
}
