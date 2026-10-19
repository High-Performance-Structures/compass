import { createPrintSnapshot } from "@/app/actions/print-snapshots"
import type { PrintSnapshotKind } from "@/lib/print/snapshot-kinds"

/**
 * Print Preview for a document assembled in the browser: saves its markup and
 * opens the preview tab. The tab opens during the click so popup blockers
 * allow it, then moves to the preview once the snapshot is saved.
 */
export async function openPrintSnapshot(input: {
  readonly projectId: string | null
  readonly kind: PrintSnapshotKind
  readonly title: string
  readonly documentNumber: string | null
  readonly html: string
}): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  const tab = window.open("", "_blank")
  if (tab) {
    tab.opener = null
    tab.document.title = "Preparing print preview"
    tab.document.body.textContent = "Compass is preparing the print preview..."
  }
  const result = await createPrintSnapshot(input)
  if (!result.success) {
    tab?.close()
    return result
  }
  const href = `/print/snapshot/${result.id}`
  if (tab) tab.location.replace(href)
  else window.location.href = href
  return { success: true }
}
