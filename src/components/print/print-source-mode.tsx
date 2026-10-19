"use client"

import * as React from "react"

/**
 * For print-only documents: adds the body class their print styles expect,
 * then marks the page ready so the PDF renderer waits for it.
 */
export function PrintSourceMode({ bodyClass }: { readonly bodyClass: string }): React.ReactElement {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    document.body.classList.add(bodyClass)
    setReady(true)
    return () => document.body.classList.remove(bodyClass)
  }, [bodyClass])
  return ready ? <span data-print-ready="true" hidden /> : <></>
}
