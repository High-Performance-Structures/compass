"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { publishProjectArchive, setProjectArchiveVisibility, type ProjectArchiveWorkspace } from "@/app/actions/project-archives"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { useArchivePagination } from "@/components/projects/use-archive-pagination"
import { ARCHIVE_KINDS } from "@/lib/project-archive-model"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"

export function ProjectArchiveWorkspacePanel({ workspace }: { readonly workspace: ProjectArchiveWorkspace }): React.ReactElement {
  const router = useRouter()
  const { table, controls, query, setQuery } = useArchivePagination(workspace.documents, "staff-archive-page-size")
  const [fileId, setFileId] = React.useState("")
  const [kind, setKind] = React.useState("daily_log")
  const [pending, startTransition] = React.useTransition()
  const [audience, setAudience] = React.useState("owner")
  const [selected, setSelected] = React.useState<readonly string[]>([])
  const [reason, setReason] = React.useState("")
  const form = React.useRef<HTMLFormElement>(null)
  const readers = workspace.readers.filter((reader) => reader.audience === audience)

  function publish(): void {
    if (!form.current) return
    const values = new FormData(form.current)
    startTransition(async () => {
      const result = await publishProjectArchive(workspace.projectId, { title: values.get("title"), period: values.get("period"), kind, driveFileId: fileId, audience, recipientUserIds: selected, sourceRecordIds: String(values.get("sourceIds") ?? "").split(/[\s,]+/).filter(Boolean), sourceAudienceEvidence: values.get("evidence"), audienceConfirmed: values.get("confirmed") === "on" })
      if (!result.success) { toast.error(result.error); return }
      toast.success("Archive edition published")
      form.current?.reset()
      setSelected([])
      setFileId("")
      router.refresh()
    })
  }

  function changeVisibility(id: string, status: "published" | "revoked"): void {
    startTransition(async () => {
      const result = await setProjectArchiveVisibility(workspace.projectId, id, { status, reason, confirmed: true })
      if (!result.success) { toast.error(result.error); return }
      toast.success(status === "revoked" ? "Archive removed from recipient workspaces" : "Archive restored")
      setReason("")
      router.refresh()
    })
  }

  return (
    <section className="mt-6 space-y-4 border-t pt-5" aria-labelledby="staff-buildertrend-archive">
      <h2 id="staff-buildertrend-archive" className="text-lg font-semibold">Buildertrend Archive</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">Publish reviewed historical PDFs to named project accounts. Internal masters stay private. Publication sends no email or notification.</p>
      {!workspace.configured ? <p className="text-sm text-muted-foreground">An administrator must configure private archive delivery and excluded master folders in Settings → Workflows → Buildertrend Archive delivery.</p> : null}
      {workspace.sourceError ? <p role="alert" className="text-sm text-destructive">{workspace.sourceError}</p> : null}
      {workspace.documents.length ? <><Label htmlFor="staff-archive-search" className="sr-only">Find an archive edition</Label><Input id="staff-archive-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an edition by title or dates" className="max-w-md" /><ul className="divide-y border-y">{table.getRowModel().rows.map(({ original: document }) => (
        <li key={document.id} className="space-y-2 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="font-medium">{document.title} · {document.status === "revoked" ? "Removed" : "Published"}</h3><p className="text-sm text-muted-foreground">{document.period} · {document.pageCount} pages · {document.sourceCount} records</p><p className="text-sm text-muted-foreground">Recipients: {document.recipients.join(", ") || "No current accounts"}</p></div>
            <div className="flex gap-2"><Button variant="outline" size="sm" asChild><Link href={`/api/projects/${workspace.projectId}/archive/${document.id}/download`} target="_blank">Review PDF</Link></Button>
              {(document.status === "published" ? workspace.canRemove : workspace.canRestore) ? (
                <AlertDialog><AlertDialogTrigger asChild><Button variant="outline" size="sm" disabled={pending} onClick={() => setReason("")}>{document.status === "published" ? "Remove" : "Restore"}</Button></AlertDialogTrigger>
                  <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{document.status === "published" ? "Remove this archive?" : "Restore this archive?"}</AlertDialogTitle><AlertDialogDescription>{document.status === "published" ? "This stops new recipient downloads. The private PDF and publication record remain available for staff recovery." : "This restores access only for the original named recipients who still have matching project access. The PDF will be verified again."}</AlertDialogDescription></AlertDialogHeader>
                    <Label htmlFor="archive-change-reason">Reason</Label><Input id="archive-change-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} />
                    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={pending || reason.trim().length < 5} onClick={() => changeVisibility(document.id, document.status === "published" ? "revoked" : "published")}>Confirm</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent></AlertDialog>
              ) : null}
            </div>
          </div>
        </li>
      ))}</ul>{controls}</> : <p className="text-sm text-muted-foreground">No archive editions published yet.</p>}
      {workspace.canPublish && workspace.configured ? <form ref={form} className="max-w-3xl space-y-4 border-t pt-4" onSubmit={(event) => event.preventDefault()}>
        <h3 className="font-medium">Publish a reviewed edition</h3>
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor="archive-title">Title</Label><Input id="archive-title" name="title" required maxLength={200} /></div><div className="space-y-1"><Label htmlFor="archive-period">Dates covered</Label><Input id="archive-period" name="period" required maxLength={120} placeholder="January–December 2025" /></div></div>
        <div className="space-y-1"><Label htmlFor="archive-file">Prepared PDF</Label><SearchableCombobox id="archive-file" ariaLabel="Prepared archive PDF" value={fileId} onValueChange={setFileId} options={workspace.sources.map((source) => ({ value: source.id, label: source.name }))} placeholder="Choose a prepared PDF" disabled={pending} required /><p className="text-xs text-muted-foreground">Place reviewed PDFs directly in a configured delivery folder. Each volume can be up to 20 MB.</p></div>
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1"><Label htmlFor="archive-kind">Records</Label><SearchableCombobox id="archive-kind" ariaLabel="Archive record kind" value={kind} onValueChange={setKind} options={ARCHIVE_KINDS.map((value) => ({ value, label: value.replaceAll("_", " ") }))} placeholder="Choose records" disabled={pending} /></div><div className="space-y-1"><Label htmlFor="archive-audience">Edition</Label><SearchableCombobox id="archive-audience" ariaLabel="Archive edition audience" value={audience} onValueChange={(value) => { setAudience(value); setSelected([]) }} options={[{ value: "owner", label: "Client-shared" }, { value: "sub_vendor", label: "Vendor-shared" }]} placeholder="Choose an edition" disabled={pending} /></div></div>
        <fieldset className="space-y-2"><legend className="text-sm font-medium">Named recipients</legend>{readers.length ? readers.map((reader) => <label key={reader.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(reader.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, reader.id] : selected.filter((id) => id !== reader.id))} />{reader.name} · {reader.email}</label>) : <p className="text-sm text-muted-foreground">No accepted project accounts match this edition. Existing contacts must have authorized workspace access before publication.</p>}</fieldset>
        <div className="space-y-1"><Label htmlFor="archive-source-ids">Source record IDs</Label><Textarea id="archive-source-ids" name="sourceIds" required placeholder="One ID per line, or comma-separated" /></div>
        <div className="space-y-1"><Label htmlFor="archive-evidence">Audience verification notes (staff only)</Label><Textarea id="archive-evidence" name="evidence" required minLength={10} maxLength={2000} placeholder="Record the source audience, date scope, count, and attachment/comment review." /></div>
        <label className="flex items-start gap-2 text-sm"><input name="confirmed" type="checkbox" required className="mt-1" />I reviewed this PDF and its comments/attachments for the selected recipients. It contains no internal-only history.</label>
        <AlertDialog><AlertDialogTrigger asChild><Button type="button" disabled={pending || selected.length === 0 || !fileId} onClick={(event) => { if (!form.current?.reportValidity()) event.preventDefault() }}>Review publication</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Publish this archive edition?</AlertDialogTitle><AlertDialogDescription>Only these named accounts with matching current project access will receive access: {readers.filter((reader) => selected.includes(reader.id)).map((reader) => reader.name).join(", ")}. No outgoing message will be sent.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={pending} onClick={publish}>Publish edition</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      </form> : null}
    </section>
  )
}
