import Link from "next/link"
import { IconDownload, IconFileDescription, IconHistory } from "@tabler/icons-react"

import type { AudienceDocument } from "@/app/actions/project-audience-preview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { projectDocumentCategoryLabel } from "@/lib/project-documents"

function dateLabel(value: string | null): string {
  if (!value) return "Date not set"
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
}

export function ProjectAudienceDocumentLibrary({
  projectId,
  documents,
}: {
  readonly projectId: string
  readonly documents: readonly AudienceDocument[]
}): React.ReactElement {
  const current = documents.filter((document) => document.status === "current")
  const superseded = documents.filter((document) => document.status === "superseded")

  return (
    <section className="border bg-background p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Coordinated project record
          </p>
          <h1 className="mt-1 text-xl font-semibold">Plans &amp; Documents</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            This is the complete published construction set for the project. Current
            revisions are authoritative; superseded revisions remain available for
            coordination history.
          </p>
        </div>
        <Badge variant="outline">Entire project team</Badge>
      </div>

      {current.length > 0 ? (
        <div className="mt-5 divide-y border-y">
          {current.map((document) => (
            <article key={document.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <IconFileDescription className="size-4 text-muted-foreground" />
                  <h2 className="font-medium">{document.title}</h2>
                  <Badge>Current</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {projectDocumentCategoryLabel(document.category)} · {dateLabel(document.documentDate)}
                  {document.revision ? ` · Revision ${document.revision}` : ""}
                </p>
                {document.description && (
                  <p className="mt-2 text-sm text-muted-foreground">{document.description}</p>
                )}
              </div>
              {document.downloadable && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/api/projects/${projectId}/documents/${document.id}/download`}>
                    <IconDownload className="size-4" />Download
                  </Link>
                </Button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-5 border-y py-8 text-center text-sm text-muted-foreground">
          No current plans or specifications have been published yet.
        </p>
      )}

      {superseded.length > 0 && (
        <details className="mt-5 border-t pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
            <IconHistory className="size-4 text-muted-foreground" />
            Superseded revisions ({superseded.length})
          </summary>
          <div className="mt-3 divide-y border-y">
            {superseded.map((document) => (
              <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium">{document.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {projectDocumentCategoryLabel(document.category)} · {dateLabel(document.documentDate)}
                    {document.revision ? ` · Revision ${document.revision}` : ""}
                  </p>
                </div>
                {document.downloadable && (
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/api/projects/${projectId}/documents/${document.id}/download`}>
                      <IconDownload className="size-4" />Download
                    </Link>
                  </Button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
