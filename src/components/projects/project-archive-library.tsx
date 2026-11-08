"use client"

import * as React from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"

import { RecordSearchInput, RecordTable, useRecordTable } from "@/components/record-table"
import { Button } from "@/components/ui/button"
import type { ArchiveSummary } from "@/lib/project-archives"

function downloadHref(projectId: string, document: ArchiveSummary): string {
  return `/api/projects/${projectId}/archive/${document.id}/download`
}

const editionId = (document: ArchiveSummary): string => document.id

export function archiveEditionColumns(projectId: string): ColumnDef<ArchiveSummary>[] {
  return [
    {
      id: "title",
      accessorFn: (row) => row.title,
      header: "Edition",
      size: 280,
      cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
    },
    { id: "period", accessorFn: (row) => row.period, header: "Dates", size: 200 },
    {
      id: "pages",
      accessorFn: (row) => row.pageCount,
      header: "Pages",
      size: 90,
      cell: ({ row }) => <span className="tabular-nums">{row.original.pageCount}</span>,
    },
    {
      id: "sources",
      accessorFn: (row) => row.sourceCount,
      header: "Source records",
      size: 130,
      cell: ({ row }) => <span className="tabular-nums">{row.original.sourceCount}</span>,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      size: 120,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" asChild>
            <Link href={downloadHref(projectId, row.original)} target="_blank">Open PDF</Link>
          </Button>
        </div>
      ),
    },
  ]
}

export function ProjectArchiveLibrary({ projectId, documents }: { readonly projectId: string; readonly documents: readonly ArchiveSummary[] }): React.ReactElement {
  const [query, setQuery] = React.useState("")
  const visible = React.useMemo(() => {
    const term = query.toLowerCase()
    return documents.filter((row) => `${row.title} ${row.period}`.toLowerCase().includes(term))
  }, [documents, query])
  const columns = React.useMemo(() => archiveEditionColumns(projectId), [projectId])
  const table = useRecordTable({ data: visible, columns, getRowId: editionId, resetKey: query, sheetId: "archives.audience" })
  return <section className="mt-6 space-y-3 border-t pt-5" aria-labelledby="buildertrend-archive">
    <h2 id="buildertrend-archive" className="text-lg font-semibold">Buildertrend Archive</h2>
    <p className="text-sm text-muted-foreground">Historical reading copies shared with you. Search within each PDF for a date or topic. Current project work stays in its Compass section.</p>
    {documents.length === 0 ? <p className="text-sm text-muted-foreground">No archive editions have been shared with this account yet.</p> : <>
      <RecordSearchInput value={query} onChange={setQuery} label="Find an archive edition" placeholder="Find an edition by title or dates" className="max-w-md" />
      <RecordTable
        table={table}
        itemLabel="archive editions"
        emptyMessage="No editions match this search."
        rowIdPrefix="archive-edition"
        // An edition opens as its PDF in a new tab, like its Open PDF button.
        onRowOpen={(document) => window.open(downloadHref(projectId, document), "_blank", "noopener")}
      />
    </>}
  </section>
}
