"use client"

import * as React from "react"

/**
 * Applies the print-only body class the shared report styles expect, then
 * marks the page ready so the PDF renderer waits for it.
 */
export function RecordCopyPrintMode({ selectionReport }: { readonly selectionReport: boolean }): React.ReactElement {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    if (selectionReport) document.body.classList.add("selection-printing-selected")
    setReady(true)
    return () => document.body.classList.remove("selection-printing-selected")
  }, [selectionReport])
  return ready ? <span data-record-copy-ready="true" hidden /> : <></>
}
