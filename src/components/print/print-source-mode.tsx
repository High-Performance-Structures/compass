"use client"

import * as React from "react"

/** Long enough for a page of Drive photos; the PDF renderer itself waits 60s. */
const IMAGE_WAIT_MS = 40_000

/**
 * Starts every image on the page (lazy images below the fold would otherwise
 * never load in the PDF renderer) and waits until each has loaded or failed.
 */
async function waitForPageImages(): Promise<void> {
  const images = Array.from(document.images)
  for (const image of images) image.loading = "eager"
  const loaded = Promise.all(
    images.map((image) =>
      image.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true })
            image.addEventListener("error", () => resolve(), { once: true })
          })
    )
  )
  await Promise.race([loaded, new Promise<void>((resolve) => window.setTimeout(resolve, IMAGE_WAIT_MS))])
}

/**
 * Marks a print page ready for the PDF renderer once its photos have loaded.
 * Print-only documents pass the body class their print styles expect.
 */
export function PrintSourceMode({ bodyClass }: { readonly bodyClass?: string }): React.ReactElement {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    let active = true
    if (bodyClass) document.body.classList.add(bodyClass)
    void waitForPageImages().then(() => {
      if (active) setReady(true)
    })
    return () => {
      active = false
      if (bodyClass) document.body.classList.remove(bodyClass)
    }
  }, [bodyClass])
  return ready ? <span data-print-ready="true" hidden /> : <></>
}
