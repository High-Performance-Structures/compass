"use client"

import { useMemo, useState, useTransition, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  IconArchive,
  IconChevronLeft,
  IconDownload,
  IconFileDescription,
  IconFolder,
  IconHistory,
  IconPlus,
  IconTrash,
  IconUsersGroup,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  deleteProjectDocument,
  listProjectDocumentSourceFolder,
  publishProjectDocument,
  updateProjectDocumentStatus,
  type ProjectDocumentWorkspace,
} from "@/app/actions/project-documents"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  PROJECT_DOCUMENT_CATEGORIES,
  projectDocumentCategoryLabel,
} from "@/lib/project-documents"

function statusLabel(value: string): string {
  return value.replaceAll("_", " ")
}

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

type SourceFolderTrailItem = {
  readonly id: string
  readonly name: string
  readonly path: string
}

export function ProjectDocumentsWorkspacePanel({
  workspace,
}: {
  readonly workspace: ProjectDocumentWorkspace
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isFolderPending, startFolderTransition] = useTransition()
  const [sourceFileId, setSourceFileId] = useState("")
  const [sourceFiles, setSourceFiles] = useState(workspace.sourceFiles)
  const [sourceError, setSourceError] = useState(workspace.sourceError)
  const [folderTrail, setFolderTrail] = useState<readonly SourceFolderTrailItem[]>(
    workspace.project.driveFolderId
      ? [{ id: workspace.project.driveFolderId, name: "Project folder", path: "" }]
      : []
  )
  const [category, setCategory] = useState("architectural_plans")
  const [title, setTitle] = useState("")
  const [supersedesDocumentId, setSupersedesDocumentId] = useState("")

  const sourceOptions = useMemo(
    () =>
      sourceFiles.map((file) => ({
        value: file.id,
        label: file.name,
        selectedLabel: file.name,
        description: file.kind === "folder"
          ? `${file.path || "Project folder"} · Folder`
          : file.path || "Project folder",
        keywords: `${file.path} ${file.mimeType} ${file.kind}`,
      })),
    [sourceFiles]
  )
  const currentOptions = workspace.documents
    .filter((document) => document.status === "current")
    .map((document) => ({
      value: document.id,
      label: document.title,
      selectedLabel: document.title,
      description: [
        projectDocumentCategoryLabel(document.category),
        document.revision ? `Revision ${document.revision}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }))

  function loadFolder(
    folder: SourceFolderTrailItem,
    nextTrail: readonly SourceFolderTrailItem[]
  ): void {
    startFolderTransition(async () => {
      const result = await listProjectDocumentSourceFolder(
        workspace.project.id,
        folder.id,
        folder.path
      )
      if (!result.success) {
        setSourceError(result.error)
        toast.error(result.error)
        return
      }
      setSourceError(null)
      setSourceFileId("")
      setSourceFiles(result.files)
      setFolderTrail(nextTrail)
    })
  }

  function chooseSource(value: string): void {
    const source = sourceFiles.find((file) => file.id === value)
    if (source?.kind === "folder") {
      const path = source.path ? `${source.path}/${source.name}` : source.name
      const folder = { id: source.id, name: source.name, path }
      loadFolder(folder, [...folderTrail, folder])
      return
    }
    setSourceFileId(value)
    if (source) setTitle(source.name.replace(/\.[^.]+$/, ""))
  }

  function goUpOneFolder(): void {
    if (folderTrail.length <= 1) return
    const nextTrail = folderTrail.slice(0, -1)
    const parent = nextTrail[nextTrail.length - 1]
    if (parent) loadFolder(parent, nextTrail)
  }

  function publish(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    startTransition(async () => {
      const result = await publishProjectDocument(workspace.project.id, {
        sourceDriveFileId: sourceFileId,
        category,
        title,
        description: String(data.get("description") ?? ""),
        documentDate: String(data.get("documentDate") ?? ""),
        revision: String(data.get("revision") ?? ""),
        supersedesDocumentId,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Document published to owners, subcontractors, and internal staff.")
      setSourceFileId("")
      setTitle("")
      setSupersedesDocumentId("")
      form.reset()
      router.refresh()
    })
  }

  function changeStatus(documentId: string, nextStatus: string, titleValue: string): void {
    const warning = nextStatus === "archived"
      ? `Archive “${titleValue}”? It will disappear from owner and subcontractor workspaces.`
      : `Mark “${titleValue}” as ${statusLabel(nextStatus)}?`
    if (!window.confirm(warning)) return
    startTransition(async () => {
      const result = await updateProjectDocumentStatus(
        workspace.project.id,
        documentId,
        nextStatus
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Document status updated.")
      router.refresh()
    })
  }

  function remove(documentId: string, titleValue: string): void {
    if (
      !window.confirm(
        `Permanently delete the archived Compass publication record for “${titleValue}”? The source Drive file will remain untouched.`
      )
    ) return
    startTransition(async () => {
      const result = await deleteProjectDocument(workspace.project.id, documentId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Archived publication record deleted.")
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      <section className="border bg-background p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <IconUsersGroup className="size-5 text-primary" />
              <h2 className="font-semibold">Entire project team</h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Every published plan and specification is automatically available to
              owners, assigned subcontractors, and authorized internal staff. Audience
              selection is intentionally not configurable for construction documents.
            </p>
          </div>
          <Badge variant="outline">Project-wide access</Badge>
        </div>
      </section>

      <section className="border bg-background p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Published construction documents</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Current revisions appear first. Superseded revisions remain available for
              coordination and historical estimate or contract support.
            </p>
          </div>
          <Badge variant="secondary">{workspace.documents.length} documents</Badge>
        </div>

        {workspace.documents.length > 0 ? (
          <div className="mt-4 divide-y border-y">
            {workspace.documents.map((document) => (
              <article key={document.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <IconFileDescription className="size-4 shrink-0 text-muted-foreground" />
                    <h3 className="font-medium">{document.title}</h3>
                    <Badge variant={document.status === "current" ? "default" : "outline"}>
                      {statusLabel(document.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {projectDocumentCategoryLabel(document.category)} · {dateLabel(document.documentDate)}
                    {document.revision ? ` · Revision ${document.revision}` : ""}
                  </p>
                  {document.description && (
                    <p className="mt-2 text-sm text-muted-foreground">{document.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>Owners</span><span aria-hidden="true">·</span>
                    <span>All assigned subs</span><span aria-hidden="true">·</span>
                    <span>Internal staff</span>
                  </div>
                  {document.references.length > 0 && (
                    <div className="mt-3 border-l-2 border-primary/30 pl-3 text-xs">
                      <p className="font-medium">Estimate and contract basis</p>
                      {document.references.map((reference) => (
                        <p key={reference.estimateId} className="mt-1 text-muted-foreground">
                          <Link
                            className="font-medium text-foreground hover:underline"
                            href={`/dashboard/projects/${workspace.project.id}/estimate?estimateId=${encodeURIComponent(reference.estimateId)}`}
                          >
                            {reference.estimateLabel}
                          </Link>
                          {reference.contracts.map((contract) => (
                            <span key={contract.id}>
                              {" · "}
                              <Link
                                className="font-medium text-foreground hover:underline"
                                href={`/dashboard/projects/${workspace.project.id}/contracts?packetId=${encodeURIComponent(contract.id)}`}
                              >
                                {contract.label}
                              </Link>
                            </span>
                          ))}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/api/projects/${workspace.project.id}/documents/${document.id}/download`}>
                      <IconDownload className="size-4" />Download
                    </Link>
                  </Button>
                  {document.status === "current" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => changeStatus(document.id, "superseded", document.title)}
                    >
                      <IconHistory className="size-4" />Supersede
                    </Button>
                  )}
                  {document.status !== "archived" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => changeStatus(document.id, "archived", document.title)}
                    >
                      <IconArchive className="size-4" />Archive
                    </Button>
                  )}
                  {document.status === "archived" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={isPending}
                      onClick={() => remove(document.id, document.title)}
                    >
                      <IconTrash className="size-4" />Delete
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 border-y py-8 text-center text-sm text-muted-foreground">
            No construction documents have been published yet.
          </p>
        )}
      </section>

      <section className="border bg-background p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <IconPlus className="size-5 text-primary" />
          <h2 className="font-semibold">Publish from this project’s folder</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Select the exact Drive file that belongs in the coordinated construction set.
        </p>
        {sourceError && sourceFiles.length === 0 ? (
          <p className="mt-4 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {sourceError}
          </p>
        ) : (
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={publish}>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="project-document-source">Project file</Label>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isFolderPending || folderTrail.length <= 1}
                  onClick={goUpOneFolder}
                >
                  <IconChevronLeft className="size-4" />
                  Up one folder
                </Button>
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <IconFolder className="size-4 shrink-0" />
                  <span className="truncate">
                    {folderTrail.map((folder) => folder.name).join(" / ") || "Project folder"}
                  </span>
                </span>
              </div>
              <SearchableCombobox
                id="project-document-source"
                ariaLabel="Project construction document file"
                placeholder={isFolderPending ? "Loading project folder..." : "Choose a file or open a folder"}
                searchPlaceholder="Search this folder..."
                emptyMessage="No files or folders match this search."
                options={sourceOptions}
                value={sourceFileId}
                onValueChange={chooseSource}
                disabled={isFolderPending}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-document-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="project-document-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROJECT_DOCUMENT_CATEGORIES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-document-title">Display title</Label>
              <Input
                id="project-document-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-document-date">Document date</Label>
              <Input id="project-document-date" name="documentDate" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-document-revision">Revision</Label>
              <Input id="project-document-revision" name="revision" placeholder="Example: Rev 4" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="project-document-supersedes">Replaces a current document</Label>
              <SearchableCombobox
                id="project-document-supersedes"
                ariaLabel="Document revision being replaced"
                placeholder="None — publish as an additional current document"
                searchPlaceholder="Search current documents..."
                emptyMessage="No current documents match."
                options={currentOptions}
                value={supersedesDocumentId}
                onValueChange={setSupersedesDocumentId}
              />
              {supersedesDocumentId && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setSupersedesDocumentId("")}>
                  Clear replacement
                </Button>
              )}
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="project-document-description">Description or issue note</Label>
              <Textarea id="project-document-description" name="description" rows={3} />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={isPending || !sourceFileId || !title.trim()}>
                <IconPlus className="size-4" />
                {isPending ? "Publishing..." : "Publish to entire project team"}
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
