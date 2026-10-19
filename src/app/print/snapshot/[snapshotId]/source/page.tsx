export const dynamic = "force-dynamic"

import { createElement } from "react"
import { notFound } from "next/navigation"

import { PrintSourceMode } from "@/components/print/print-source-mode"
import { PRINT_SNAPSHOT_KINDS } from "@/lib/print/snapshot-kinds"
import { loadOwnPrintSnapshot } from "@/lib/print/snapshots"

/** The page the PDF renderer opens for a snapshot. */
export default async function PrintSnapshotSourcePage({
  params,
}: {
  readonly params: Promise<{ snapshotId: string }>
}): Promise<React.ReactElement> {
  const { snapshotId } = await params
  const snapshot = await loadOwnPrintSnapshot(snapshotId)
  if (!snapshot) notFound()
  const kind = PRINT_SNAPSHOT_KINDS[snapshot.kind]
  return (
    <>
      {createElement(kind.rootTag, {
        [kind.rootAttribute]: "true",
        className: kind.rootClass,
        // Only the snapshot's creator can open it (see loadOwnPrintSnapshot).
        dangerouslySetInnerHTML: { __html: snapshot.html },
      })}
      <PrintSourceMode bodyClass={kind.bodyClass} />
    </>
  )
}
