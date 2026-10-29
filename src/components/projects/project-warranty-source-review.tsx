"use client"

import * as React from "react"
import { getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import type { WarrantySourceReviewPage } from "@/app/actions/project-warranty-source-review"
import { DataTablePagination } from "@/components/data-table-pagination"
import { warrantySourceDate } from "@/lib/warranty/source-review"

function label(value: string): string {
  return value.replaceAll("_", " ")
}

export function ProjectWarrantySourceReview({ page }: { readonly page: WarrantySourceReviewPage }): React.ReactElement {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [pending, startTransition] = React.useTransition()
  const data = React.useMemo(() => [...page.records], [page.records])
  const table = useReactTable({
    data,
    columns: [{ id: "id", accessorFn: (row) => row.id }],
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: page.total,
    state: { pagination: { pageIndex: page.pageIndex, pageSize: page.pageSize } },
    onPaginationChange: (updater) => {
      const current = { pageIndex: page.pageIndex, pageSize: page.pageSize }
      const next = typeof updater === "function" ? updater(current) : updater
      const params = new URLSearchParams(search.toString())
      params.set("historyPage", String(next.pageSize === current.pageSize ? next.pageIndex + 1 : 1))
      params.set("historySize", String(next.pageSize))
      startTransition(() => router.replace(`${pathname}?${params}`, { scroll: false }))
    },
  })

  return (
    <section className="mt-8 space-y-4 border-t pt-6" aria-labelledby="historical-warranty-title" aria-busy={pending}>
      <div>
        <h2 id="historical-warranty-title" className="text-lg font-semibold">Historical warranty records</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {page.total} source records · Staff only. Review the original dates,
          comments and completion evidence alongside current claims. Historical
          source statuses do not change the active warranty workflow.
        </p>
      </div>
      {page.total === 0 ? <p className="text-sm text-muted-foreground">No historical warranty records have been imported for this project.</p> : null}
      <div className="divide-y">
        {page.records.map((record) => (
          <details key={record.id} className="py-4">
            <summary className="cursor-pointer space-y-1">
              <span className="font-medium">{record.claimNumber ? `${record.claimNumber} · ` : ""}{record.title}</span>
              <span className="ml-2 text-sm text-muted-foreground">
                {warrantySourceDate(record.sourceCreatedAt)} · Source: {record.sourceStatus ?? "Not recorded"} · Review: {label(record.reviewStatus)}
              </span>
            </summary>
            <div className="mt-4 space-y-4 text-sm">
              <dl className="grid gap-3 sm:grid-cols-3">
                <div><dt className="text-muted-foreground">Buildertrend created</dt><dd>{warrantySourceDate(record.sourceCreatedAt)}</dd></div>
                <div><dt className="text-muted-foreground">Buildertrend modified</dt><dd>{warrantySourceDate(record.sourceUpdatedAt)}</dd></div>
                <div><dt className="text-muted-foreground">Source priority</dt><dd>{record.sourcePriority ?? "Not recorded"}</dd></div>
              </dl>
              {record.existingClaim ? <p className="border-l-2 border-primary pl-3">Existing Compass claim: {record.existingClaim.claimNumber} · {record.existingClaim.title} · {label(record.existingClaim.status)}. Review this record before creating another claim.</p> : null}
              {record.reviewNotes ? <div><h3 className="font-medium">Review notes</h3><p className="mt-1 whitespace-pre-wrap">{record.reviewNotes}</p></div> : null}
              {record.description ? <div><h3 className="font-medium">Original description</h3><p className="mt-1 whitespace-pre-wrap">{record.description}</p></div> : null}
              {record.evidence.internalNotes ? <div><h3 className="font-medium">Source internal notes</h3><p className="mt-1 whitespace-pre-wrap">{record.evidence.internalNotes}</p></div> : null}
              {record.evidence.comments.map((comment) => <details key={comment.audience} className="border-t pt-3"><summary className="cursor-pointer font-medium">Source comments · {comment.audience}</summary><p className="mt-2 whitespace-pre-wrap">{comment.text}</p></details>)}
              <p className="text-muted-foreground">{record.evidence.serviceCount === null ? "Service history count not recorded." : `${record.evidence.serviceCount} captured service histories.`} The reading copy and source backup retain the full captured evidence and attachment references.</p>
              <div className="flex flex-wrap gap-4">
                {record.evidence.readingCopyHref ? <a className="underline underline-offset-4" href={record.evidence.readingCopyHref} target="_blank" rel="noopener noreferrer">Open history reading copy</a> : null}
                {record.evidence.sourceBackupHref ? <a className="underline underline-offset-4" href={record.evidence.sourceBackupHref} target="_blank" rel="noopener noreferrer">Open source evidence backup</a> : null}
              </div>
              {!record.evidence.structuredEvidenceAvailable ? <p className="text-muted-foreground">Additional structured evidence is unavailable for this import. The original description and review notes remain shown above.</p> : null}
            </div>
          </details>
        ))}
      </div>
      {page.total > 0 ? <DataTablePagination table={table} itemLabel="source records on this page" id="warranty-history-page-size" /> : null}
    </section>
  )
}
