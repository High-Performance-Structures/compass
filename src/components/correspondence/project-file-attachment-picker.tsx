"use client"

import * as React from "react"
import { ArrowLeft, FileText, Folder, LoaderCircle, Paperclip } from "lucide-react"
import { attachCorrespondenceProjectFile, getCorrespondenceProjectFiles } from "@/app/actions/correspondence-attachments"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { CorrespondenceAttachment } from "@/lib/correspondence/types"
import type { ProjectAttachmentFile } from "@/lib/correspondence/project-file-attachments"

export function ProjectFileAttachmentPicker(props: {
  readonly projectId: string
  readonly disabled: boolean
  readonly onAttached: (attachment: CorrespondenceAttachment) => void
  readonly onBusyChange: (busy: boolean) => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [files, setFiles] = React.useState<readonly ProjectAttachmentFile[]>([])
  const [folders, setFolders] = React.useState<readonly { readonly id: string; readonly name: string }[]>([])
  const [query, setQuery] = React.useState("")
  const [nextPage, setNextPage] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [attaching, setAttaching] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const busyRef = React.useRef(false)
  const requestRef = React.useRef(0)

  async function load(path: typeof folders, page: string | null = null): Promise<void> {
    const request = ++requestRef.current
    setLoading(true); setError(null)
    try {
      const result = await getCorrespondenceProjectFiles(props.projectId, path.at(-1)?.id ?? null, page)
      if (request !== requestRef.current) return
      if (!result.success) { setError(result.error); return }
      setFiles((current) => page ? [...current, ...result.data.files] : result.data.files)
      setFolders(path); setNextPage(result.data.nextPageToken); setQuery("")
    } catch { if (request === requestRef.current) setError("Project files could not be loaded. Try again.") } finally { if (request === requestRef.current) setLoading(false) }
  }
  async function attach(file: ProjectAttachmentFile): Promise<void> {
    if (busyRef.current || props.disabled) return
    busyRef.current = true; setAttaching(file.id); props.onBusyChange(true); setError(null)
    try {
      const result = await attachCorrespondenceProjectFile(props.projectId, file.id)
      if (!result.success) { setError(result.error); return }
      props.onAttached({ ...result.data, available: true })
      setOpen(false)
    } catch { setError("The file could not be attached. Try again.") } finally { busyRef.current = false; setAttaching(null); props.onBusyChange(false) }
  }
  return <>
    <Button type="button" size="sm" variant="outline" disabled={props.disabled} onClick={() => { setOpen(true); void load([]) }}><Paperclip />Project files</Button>
    <Dialog open={open} onOpenChange={(next) => { if (!busyRef.current) { setOpen(next); if (!next) requestRef.current += 1 } }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Attach a project file</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Attach a copy to this message. The original project file stays unchanged.</p>
        <div className="flex items-center gap-2"><Button type="button" variant="ghost" size="sm" disabled={!folders.length || loading || attaching !== null} onClick={() => void load(folders.slice(0, -1))}><ArrowLeft />Back</Button><span className="truncate text-sm">{folders.at(-1)?.name ?? "Project files"}</span></div>
        <Input aria-label="Filter project files" placeholder="Filter files in this folder…" value={query} onChange={(event) => setQuery(event.target.value)} disabled={loading || attaching !== null} />
        <div className="max-h-80 overflow-y-auto divide-y border-y" aria-busy={loading}>
          {files.filter((file) => file.name.toLowerCase().includes(query.toLowerCase())).map((file) => <Button key={file.id} type="button" variant="ghost" className="h-auto w-full justify-start py-3 text-left" disabled={loading || attaching !== null || props.disabled} onClick={() => file.kind === "folder" ? void load([...folders, { id: file.id, name: file.name }]) : void attach(file)}>{attaching === file.id ? <LoaderCircle className="animate-spin" /> : file.kind === "folder" ? <Folder /> : <FileText />}<span className="min-w-0 truncate">{file.name}</span></Button>)}
          {loading && <p className="p-3 text-sm">Loading project files…</p>}
          {!loading && files.length === 0 && !error && <p className="p-3 text-sm text-muted-foreground">No available files in this folder.</p>}
        </div>
        {nextPage && <Button type="button" variant="outline" disabled={loading || attaching !== null} onClick={() => void load(folders, nextPage)}>Load more files</Button>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  </>
}
