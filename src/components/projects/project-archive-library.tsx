"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useArchivePagination } from "@/components/projects/use-archive-pagination"
import type { ArchiveSummary } from "@/lib/project-archives"

export function ProjectArchiveLibrary({ projectId, documents }: { readonly projectId: string; readonly documents: readonly ArchiveSummary[] }): React.ReactElement {
  const { table, controls, query, setQuery } = useArchivePagination(documents, "archive-library-page-size")
  return <section className="mt-6 space-y-3 border-t pt-5" aria-labelledby="buildertrend-archive">
    <h2 id="buildertrend-archive" className="text-lg font-semibold">Buildertrend Archive</h2>
    <p className="text-sm text-muted-foreground">Historical reading copies shared with you. Search within each PDF for a date or topic. Current project work stays in its Compass section.</p>
    {documents.length === 0 ? <p className="text-sm text-muted-foreground">No archive editions have been shared with this account yet.</p> : <>
      <Label htmlFor="archive-search" className="sr-only">Find an archive edition</Label><Input id="archive-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an edition by title or dates" className="max-w-md" />
      <ul className="divide-y border-y">{table.getRowModel().rows.map(({ original: document }) => <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><h3 className="font-medium">{document.title}</h3><p className="text-sm text-muted-foreground">{document.period} · {document.pageCount} pages · {document.sourceCount} source records</p></div><Button variant="outline" size="sm" asChild><Link href={`/api/projects/${projectId}/archive/${document.id}/download`} target="_blank">Open PDF</Link></Button></li>)}</ul>
      {table.getFilteredRowModel().rows.length === 0 ? <p className="text-sm text-muted-foreground">No editions match this search.</p> : null}
      {controls}
    </>}
  </section>
}
