const PRINT_IMAGE_TIMEOUT_MS = 3_000

/**
 * Wait for every image in an isolated print tree to load and decode before the
 * browser snapshots it. This is especially important for department PNG logos,
 * which otherwise disappear when a hidden print layout is revealed on demand.
 */
export async function waitForPrintLayout(root: HTMLElement): Promise<void> {
  const browserWindow = root.ownerDocument.defaultView
  if (!browserWindow) return

  await Promise.all(
    Array.from(root.querySelectorAll("img")).map(async (image) => {
      if (!image.complete) {
        await new Promise<void>((resolve) => {
          let settled = false
          const finish = (): void => {
            if (settled) return
            settled = true
            browserWindow.clearTimeout(timeoutId)
            image.removeEventListener("load", finish)
            image.removeEventListener("error", finish)
            resolve()
          }
          const timeoutId = browserWindow.setTimeout(
            finish,
            PRINT_IMAGE_TIMEOUT_MS
          )

          image.addEventListener("load", finish, { once: true })
          image.addEventListener("error", finish, { once: true })

          // The image can settle between the initial complete check and the
          // listener registration, particularly when it was preloaded.
          if (image.complete) finish()
        })
      }

      if (image.naturalWidth > 0) {
        try {
          await image.decode()
        } catch {
          // Cached images can remain printable even when decode() rejects.
        }
      }
    })
  )

  try {
    await root.ownerDocument.fonts.ready
  } catch {
    // Font readiness is helpful but should never prevent the print dialog.
  }

  // Allow the browser two frames to lay out newly decoded raster logos.
  await new Promise<void>((resolve) => {
    browserWindow.requestAnimationFrame(() => {
      browserWindow.requestAnimationFrame(() => resolve())
    })
  })
}

export const PRINT_STATE_TIMEOUT_MS = 5_000
export const IOS_PRINT_STATE_TIMEOUT_MS = 120_000
