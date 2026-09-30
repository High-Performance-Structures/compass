"use client"

import * as React from "react"
import { Paperclip, X } from "lucide-react"
import { removeCorrespondenceAttachment } from "@/app/actions/correspondence-attachments"
import { Button } from "@/components/ui/button"
import { MAX_PROJECT_EMAIL_ATTACHMENT_BYTES } from "@/lib/correspondence/attachment-limits"
import { ProjectFileAttachmentPicker } from "./project-file-attachment-picker"
import { uploadStagedAttachment, type StagedAttachment } from "./correspondence-workspace-utils"

export function ProjectEmailAttachments(props: {
  readonly projectId: string
  readonly locked: boolean
  readonly files: readonly StagedAttachment[]
  readonly onChange: React.Dispatch<React.SetStateAction<readonly StagedAttachment[]>>
  readonly onBusyChange: (busy: boolean) => void
  readonly onError: (error: string | null) => void
}): React.ReactElement {
  const inputId = React.useId()
  const busyRef = React.useRef(false)
  const bytes = props.files.reduce((total, file) => total + (file.attachment?.size ?? file.file?.size ?? 0), 0)
  const disabled = props.locked || props.files.some((file) => file.state === "uploading")
  async function upload(files: FileList | null): Promise<void> {
    if (!files || disabled || busyRef.current) return
    const selected = Array.from(files)
    if (props.files.length + selected.length > 10 || bytes + selected.reduce((n, file) => n + file.size, 0) > MAX_PROJECT_EMAIL_ATTACHMENT_BYTES) { props.onError("Choose at most 10 files, totaling no more than 18 MB for email."); return }
    const candidates: readonly StagedAttachment[] = selected.map((file) => ({ localId: crypto.randomUUID(), file, state: "uploading", attachment: null }))
    busyRef.current = true; props.onBusyChange(true); props.onError(null)
    props.onChange((current) => [...current, ...candidates])
    try { for (const candidate of candidates) await uploadStagedAttachment(props.projectId, candidate, props.onChange) } finally { busyRef.current = false; props.onBusyChange(false) }
  }
  async function remove(file: StagedAttachment): Promise<void> {
    if (disabled) return
    if (file.attachment?.available) {
      busyRef.current = true; props.onBusyChange(true)
      try {
        const result = await removeCorrespondenceAttachment(props.projectId, file.attachment.id)
        if (!result.success) { props.onError(result.error); return }
      } finally { busyRef.current = false; props.onBusyChange(false) }
    }
    props.onChange((current) => current.filter((item) => item.localId !== file.localId))
  }
  return <div className="grid gap-3">
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled || props.files.length >= 10} asChild><label htmlFor={inputId}><Paperclip />Upload files</label></Button>
      <input id={inputId} type="file" multiple disabled={disabled || props.files.length >= 10} className="sr-only" onChange={(event) => { void upload(event.target.files); event.currentTarget.value = "" }} />
      <ProjectFileAttachmentPicker projectId={props.projectId} disabled={disabled || props.files.length >= 10} onBusyChange={props.onBusyChange} onAttached={(attachment) => { props.onChange((current) => [...current, { localId: crypto.randomUUID(), file: null, state: "ready", attachment }]); if (bytes + attachment.size > MAX_PROJECT_EMAIL_ATTACHMENT_BYTES) props.onError("Email attachments exceed 18 MB. Remove a file before sending.") }} />
    </div>
    <p className="text-xs text-muted-foreground">Up to 10 files · 18 MB total for email. Attachments are sent as files and saved with the message.</p>
    {props.files.length > 0 && <ul className="divide-y border-y">{props.files.map((file) => <li key={file.localId} className="flex items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{file.file?.name ?? file.attachment?.name ?? "Attachment"}</span><span className="text-xs text-muted-foreground">{file.state === "uploading" ? "Uploading…" : file.state === "failed" ? "Upload failed — remove and try again" : "Ready"}</span><Button type="button" size="icon-xs" variant="ghost" disabled={disabled} aria-label={`Remove ${file.file?.name ?? file.attachment?.name ?? "attachment"}`} onClick={() => void remove(file)}><X /></Button></li>)}</ul>}
  </div>
}
