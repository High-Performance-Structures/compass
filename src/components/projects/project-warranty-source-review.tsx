"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"

import {
  loadProjectWarrantySourceReviewPage,
  type WarrantySourceReviewPage,
  type WarrantySourceReviewRecord,
} from "@/app/actions/project-warranty-source-review"
import { RecordSearchInput, RecordTable } from "@/components/record-table"
import { useServerRecordTable } from "@/components/use-server-record-table"
import type { RecordPageQuery } from "@/lib/record-page"
import { warrantySourceDate } from "@/lib/warranty/source-review"

function label(value: string): string {
  return value.replaceAll("_", " ")
}

const recordId = (record: WarrantySourceReviewRecord): string => record.id

export function warrantySourceColumns(onOpen: (record: WarrantySourceReviewRecord) => void): ColumnDef<WarrantySourceReviewRecord>[] {
  return [
    {
      id: "title",
      accessorFn: (row) => row.title,
      header: "Record",
      size: 300,
      cell: ({ row: { original: record } }) => (
        <button type="button" className="text-left font-medium hover:underline" onClick={() => onOpen(record)}>
          {record.claimNumber ? `${record.claimNumber} · ` : ""}{record.title}
        </button>
      ),
    },
    {
      id: "created",
      accessorFn: (row) => row.sourceCreatedAt ?? undefined,
      header: "Buildertrend created",
      size: 150,
      cell: ({ row }) => <span className="whitespace-nowrap">{warrantySourceDate(row.original.sourceCreatedAt)}</span>,
    },
    {
      id: "modified",
      accessorFn: (row) => row.sourceUpdatedAt ?? undefined,
      header: "Buildertrend modified",
      size: 150,
      cell: ({ row }) => <span className="whitespace-nowrap">{warrantySourceDate(row.original.sourceUpdatedAt)}</span>,
    },
    {
      id: "sourceStatus",
      accessorFn: (row) => row.sourceStatus ?? undefined,
      header: "Source status",
      size: 140,
      cell: ({ row }) => row.original.sourceStatus ?? "Not recorded",
    },
    {
      id: "priority",
      accessorFn: (row) => row.sourcePriority ?? undefined,
      header: "Source priority",
      size: 130,
      cell: ({ row }) => row.original.sourcePriority ?? "Not recorded",
    },
    {
      id: "review",
      accessorFn: (row) => row.reviewStatus,
      header: "Review",
      size: 130,
      cell: ({ row }) => <span className="capitalize">{label(row.original.reviewStatus)}</span>,
    },
    {
      id: "existingClaim",
      header: "Existing claim",
      enableSorting: false,
      size: 160,
      cell: ({ row }) => row.original.existingClaim?.claimNumber ?? <span className="text-muted-foreground">None</span>,
    },
  ]
}

/** The opened record's captured evidence, below the sheet. */
function WarrantySourceDetail({ record, onClose }: { readonly record: WarrantySourceReviewRecord; readonly onClose: () => void }): React.ReactElement {
  return (
    <article aria-labelledby="historical-warranty-record" className="space-y-4 border-t pt-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="historical-warranty-record" className="font-medium">{record.claimNumber ? `${record.claimNumber} · ` : ""}{record.title}</h3>
          <p className="text-muted-foreground">
            {warrantySourceDate(record.sourceCreatedAt)} · Source: {record.sourceStatus ?? "Not recorded"} · Review: {label(record.reviewStatus)}
          </p>
        </div>
        <button type="button" className="text-muted-foreground underline underline-offset-4" onClick={onClose}>Close</button>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Buildertrend created</dt><dd>{warrantySourceDate(record.sourceCreatedAt)}</dd></div>
        <div><dt className="text-muted-foreground">Buildertrend modified</dt><dd>{warrantySourceDate(record.sourceUpdatedAt)}</dd></div>
        <div><dt className="text-muted-foreground">Source priority</dt><dd>{record.sourcePriority ?? "Not recorded"}</dd></div>
      </dl>
      {record.existingClaim ? <p className="border-l-2 border-primary pl-3">Existing Compass claim: {record.existingClaim.claimNumber} · {record.existingClaim.title} · {label(record.existingClaim.status)}. Review this record before creating another claim.</p> : null}
      {record.reviewNotes ? <div><h4 className="font-medium">Review notes</h4><p className="mt-1 whitespace-pre-wrap">{record.reviewNotes}</p></div> : null}
      {record.description ? <div><h4 className="font-medium">Original description</h4><p className="mt-1 whitespace-pre-wrap">{record.description}</p></div> : null}
      {record.evidence.internalNotes ? <div><h4 className="font-medium">Source internal notes</h4><p className="mt-1 whitespace-pre-wrap">{record.evidence.internalNotes}</p></div> : null}
      {record.evidence.comments.map((comment) => <details key={comment.audience} className="border-t pt-3"><summary className="cursor-pointer font-medium">Source comments · {comment.audience}</summary><p className="mt-2 whitespace-pre-wrap">{comment.text}</p></details>)}
      <p className="text-muted-foreground">{record.evidence.serviceCount === null ? "Service history count not recorded." : `${record.evidence.serviceCount} captured service histories.`} The reading copy and source backup retain the full captured evidence and attachment references.</p>
      <div className="flex flex-wrap gap-4">
        {record.evidence.readingCopyHref ? <a className="underline underline-offset-4" href={record.evidence.readingCopyHref} target="_blank" rel="noopener noreferrer">Open history reading copy</a> : null}
        {record.evidence.sourceBackupHref ? <a className="underline underline-offset-4" href={record.evidence.sourceBackupHref} target="_blank" rel="noopener noreferrer">Open source evidence backup</a> : null}
      </div>
      {!record.evidence.structuredEvidenceAvailable ? <p className="text-muted-foreground">Additional structured evidence is unavailable for this import. The original description and review notes remain shown above.</p> : null}
    </article>
  )
}

export function ProjectWarrantySourceReview({
  projectId,
  page,
  query,
}: {
  readonly projectId: string
  /** The first page, read on the server with `query`. */
  readonly page: WarrantySourceReviewPage
  readonly query: RecordPageQuery
}): React.ReactElement {
  const [opened, setOpened] = React.useState<WarrantySourceReviewRecord | null>(null)
  const columns = React.useMemo(() => warrantySourceColumns(setOpened), [])
  const load = React.useCallback((next: RecordPageQuery) => loadProjectWarrantySourceReviewPage(projectId, next), [projectId])
  const sheet = useServerRecordTable({
    columns,
    getRowId: recordId,
    load,
    initialPage: page,
    initialQuery: query,
    sheetId: "warranty.source-review",
  })
  // The unfiltered total, from the server's first page; searches narrow the sheet only.
  const total = page.total

  return (
    <section className="mt-8 space-y-4 border-t pt-6" aria-labelledby="historical-warranty-title">
      <div>
        <h2 id="historical-warranty-title" className="text-lg font-semibold">Historical warranty records</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {total} source records · Staff only. Review the original dates,
          comments and completion evidence alongside current claims. Historical
          source statuses do not change the active warranty workflow.
        </p>
      </div>
      {total === 0 ? <p className="text-sm text-muted-foreground">No historical warranty records have been imported for this project.</p> : (
        <>
          <RecordSearchInput
            value={sheet.search}
            onChange={sheet.setSearch}
            label="Search historical warranty records"
            placeholder="Search claim, title or status…"
            className="sm:max-w-md"
          />
          <RecordTable
            table={sheet.table}
            state={sheet.state}
            itemLabel="source records"
            emptyMessage="No historical warranty records match this search."
            rowIdPrefix="warranty-source"
            focusedRowId={opened?.id ?? null}
            scrollToFocusedRow={false}
            onRowOpen={setOpened}
          />
          {opened ? <WarrantySourceDetail record={opened} onClose={() => setOpened(null)} /> : null}
        </>
      )}
    </section>
  )
}
