"use client"

import * as React from "react"
import { IconChevronRight, IconFile, IconFolder, IconFolderOpen } from "@tabler/icons-react"

import { listProjectFilesForPicker } from "@/app/actions/project-documents"
import type { ProjectDocumentSourceFile } from "@/app/actions/project-documents"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { PickedProjectFile } from "@/lib/files/picked-files"

export type { PickedProjectFile } from "@/lib/files/picked-files"

type Crumb = { readonly id: string | null; readonly name: string }

/** A Drive link the RFQ email can share with the vendor. */
function driveUrl(file: ProjectDocumentSourceFile): string {
  return file.kind === "folder"
    ? `https://drive.google.com/drive/folders/${file.id}`
    : `https://drive.google.com/file/d/${file.id}/view`
}

function modified(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/**
 * Browse this job's Drive folder and pick files (or whole folders) instead
 * of pasting links. Folders open on click; tick what to add.
 */
export function ProjectDriveFilePicker({
  projectId,
  open,
  onOpenChange,
  onPick,
  alreadyPickedUrls = [],
}: {
  readonly projectId: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onPick: (files: readonly PickedProjectFile[]) => void
  readonly alreadyPickedUrls?: readonly string[]
}): React.ReactElement {
  const [trail, setTrail] = React.useState<readonly Crumb[]>([{ id: null, name: "Project files" }])
  const [files, setFiles] = React.useState<readonly ProjectDocumentSourceFile[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [picked, setPicked] = React.useState<ReadonlyMap<string, PickedProjectFile>>(new Map())
  const current = trail[trail.length - 1] ?? { id: null, name: "Project files" }

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void listProjectFilesForPicker(projectId, current.id).then((result) => {
      if (cancelled) return
      setLoading(false)
      if (result.success) setFiles(result.files)
      else {
        setFiles([])
        setError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [open, projectId, current.id])

  function reset(): void {
    setTrail([{ id: null, name: "Project files" }])
    setPicked(new Map())
    setQuery("")
  }

  function toggle(file: ProjectDocumentSourceFile, on: boolean): void {
    setPicked((existing) => {
      const next = new Map(existing)
      if (on) next.set(file.id, { id: file.id, name: file.name, url: driveUrl(file), kind: file.kind })
      else next.delete(file.id)
      return next
    })
  }

  const needle = query.trim().toLowerCase()
  const shown = needle ? files.filter((file) => file.name.toLowerCase().includes(needle)) : files
  const already = new Set(alreadyPickedUrls)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose project files</DialogTitle>
          <DialogDescription>
            Open folders to find plan sheets, specs and addenda, then tick the ones to include. Whole folders work for
            Plans and Submittals.
          </DialogDescription>
        </DialogHeader>
        <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-sm">
          {trail.map((crumb, index) => (
            <React.Fragment key={`${crumb.id ?? "root"}-${index}`}>
              {index > 0 && <IconChevronRight className="size-3.5 text-muted-foreground" />}
              {index === trail.length - 1 ? (
                <span className="font-medium">{crumb.name}</span>
              ) : (
                <button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => setTrail(trail.slice(0, index + 1))}>
                  {crumb.name}
                </button>
              )}
            </React.Fragment>
          ))}
        </nav>
        <Input aria-label="Search this folder" placeholder="Search this folder" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="min-h-48 overflow-y-auto border-y" style={{ maxHeight: "45vh" }}>
          {loading ? (
            <p className="p-3 text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="p-3 text-sm text-destructive">{error}</p>
          ) : shown.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{needle ? "Nothing here matches." : "This folder is empty."}</p>
          ) : (
            <ul className="divide-y">
              {shown.map((file) => {
                const isPicked = picked.has(file.id)
                const isAlready = already.has(driveUrl(file))
                return (
                  <li key={file.id} className="flex items-center gap-3 px-2 py-2 text-sm">
                    <Checkbox
                      aria-label={`Include ${file.name}`}
                      checked={isPicked || isAlready}
                      disabled={isAlready}
                      onCheckedChange={(checked) => toggle(file, checked === true)}
                    />
                    {file.kind === "folder" ? (
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
                        onClick={() => {
                          setQuery("")
                          setTrail([...trail, { id: file.id, name: file.name }])
                        }}
                      >
                        <IconFolder className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{file.name}</span>
                      </button>
                    ) : (
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <IconFile className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{file.name}</span>
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground">{isAlready ? "Added" : modified(file.modifiedAt)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <IconFolderOpen className="size-3.5" />
            {picked.size === 0 ? "Nothing chosen yet" : `${picked.size} chosen`}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={picked.size === 0}
              onClick={() => {
                onPick([...picked.values()])
                reset()
                onOpenChange(false)
              }}
            >
              Add {picked.size || ""} {picked.size === 1 ? "file" : "files"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

