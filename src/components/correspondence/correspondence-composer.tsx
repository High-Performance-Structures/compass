import * as React from "react"
import { ArrowLeft, FileText, LoaderCircle, Paperclip, SendHorizontal, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { CorrespondenceInbox } from "@/lib/correspondence/types"
import type { StagedAttachment } from "./correspondence-workspace-utils"

type NewCompose = { readonly subject: string; readonly recipientIds: readonly string[] }

export function NewMessagePanel(props: {
  readonly inbox: CorrespondenceInbox
  readonly compose: NewCompose
  readonly body: string
  readonly stagedAttachments: readonly StagedAttachment[]
  readonly isSending: boolean
  readonly hasPendingSend: boolean
  readonly status: string | null
  readonly onBack: () => Promise<void>
  readonly onChange: (patch: Partial<NewCompose>) => void
  readonly onBodyChange: (body: string) => void
  readonly onFiles: (files: FileList | null) => Promise<void>
  readonly onRetryUpload: (id: string) => Promise<void>
  readonly onRemoveAttachment: (id: string) => void
  readonly onSend: () => Promise<void>
  readonly onSaveDraft: () => Promise<void>
  readonly onDiscard: () => Promise<void>
}): React.ReactElement {
  const selected = props.inbox.contacts.filter((person) => props.compose.recipientIds.includes(person.userId))
  return <div className="mx-auto min-h-full max-w-3xl p-4 md:p-6">
    <Button variant="ghost" size="sm" disabled={props.hasPendingSend} onClick={() => void props.onBack()}><ArrowLeft />Back to messages</Button>
    <h2 className="mt-4 text-xl font-semibold">New project message</h2>
    <p className="mt-1 text-sm text-muted-foreground">Choose people who can receive this message in Compass. Adding recipients starts a new conversation.</p>
    <div className="mt-6 grid gap-5">
      <fieldset><legend className="text-sm font-medium">To</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">
        {props.inbox.contacts.map((person) => <label key={person.userId} className="flex cursor-pointer items-center gap-3 border p-3 text-sm"><input type="checkbox" disabled={props.hasPendingSend} checked={props.compose.recipientIds.includes(person.userId)} onChange={() => props.onChange({ recipientIds: toggleRecipient(props.compose.recipientIds, person.userId) })} /><span><span className="block font-medium">{person.name}</span><span className="text-muted-foreground">{person.email} · Compass available</span></span></label>)}
      </div></fieldset>
      {selected.length > 0 && <div className="border px-3 py-2 text-sm"><span className="font-medium">Visible to: </span>{selected.map((person) => person.name).join(", ")}. No earlier correspondence is shared.</div>}
      <label className="grid gap-2 text-sm font-medium">Subject<Input disabled={props.hasPendingSend} value={props.compose.subject} onChange={(event) => props.onChange({ subject: event.target.value })} placeholder="What is this conversation about?" /></label>
      <Composer body={props.body} stagedAttachments={props.stagedAttachments} isSending={props.isSending} locked={props.hasPendingSend} onBodyChange={props.onBodyChange} onFiles={props.onFiles} onRetryUpload={props.onRetryUpload} onRemoveAttachment={props.onRemoveAttachment} onSend={props.onSend} onDiscard={() => { void props.onDiscard() }} />
      <Button variant="outline" size="sm" disabled={props.hasPendingSend} onClick={() => void props.onSaveDraft()}>Save draft</Button>
      {props.stagedAttachments.length > 0 && <p className="text-xs text-muted-foreground">Attachments stay in this browser session. Reattach them after reloading.</p>}
      {props.status !== null && <p className="border px-3 py-2 text-sm" role="status">{props.status}</p>}
    </div>
  </div>
}

export function Composer({ body, stagedAttachments, isSending, locked, onBodyChange, onFiles, onRetryUpload, onRemoveAttachment, onSend, onDiscard, submitLabel = "Send" }: {
  readonly body: string
  readonly stagedAttachments: readonly StagedAttachment[]
  readonly isSending: boolean
  readonly locked: boolean
  readonly onBodyChange: (body: string) => void
  readonly onFiles: (files: FileList | null) => Promise<void>
  readonly onRetryUpload: (id: string) => Promise<void>
  readonly onRemoveAttachment: (id: string) => void
  readonly onSend: () => Promise<void>
  readonly onDiscard: () => void
  readonly submitLabel?: string
}): React.ReactElement {
  const inputId = React.useId()
  return <div className="border-t p-4 md:p-6">
    <Textarea disabled={locked} value={body} onChange={(event) => onBodyChange(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void onSend() } }} placeholder="Write your message…" aria-label="Message body" />
    {stagedAttachments.length > 0 && <ul className="mt-3 grid gap-2">{stagedAttachments.map((attachment) => <li key={attachment.localId} className="flex items-center gap-2 border px-3 py-2 text-sm"><FileText className="size-4" /><span className="min-w-0 flex-1 truncate">{attachment.file.name}</span><span className="text-xs text-muted-foreground">{attachment.state === "uploading" ? "Uploading…" : attachment.state === "ready" ? "Ready" : "Upload failed"}</span>{attachment.state === "failed" && <Button size="xs" variant="outline" disabled={locked} onClick={() => void onRetryUpload(attachment.localId)}>Retry</Button>}<Button size="icon-xs" variant="ghost" disabled={locked} onClick={() => onRemoveAttachment(attachment.localId)} aria-label={`Remove ${attachment.file.name}`}><X /></Button></li>)}</ul>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><label htmlFor={inputId} className="inline-flex h-8 cursor-pointer items-center gap-1.5 border px-3 text-sm font-medium hover:bg-accent"><Paperclip className="size-4" />Attach file</label><input id={inputId} className="sr-only" disabled={locked} type="file" multiple onChange={(event) => { void onFiles(event.target.files); event.currentTarget.value = "" }} /><span className="text-xs text-muted-foreground">Enter adds a line · Ctrl/Cmd + Enter sends</span></div><div className="flex gap-2"><Button variant="ghost" size="sm" disabled={locked} onClick={onDiscard}>{submitLabel === "Send" ? "Discard draft" : "Cancel edit"}</Button><Button size="sm" disabled={!body.trim() || isSending || stagedAttachments.some((attachment) => attachment.state !== "ready")} onClick={() => void onSend()}>{isSending ? <LoaderCircle className="animate-spin" /> : <SendHorizontal />}{submitLabel}</Button></div></div>
  </div>
}

function toggleRecipient(ids: readonly string[], id: string): readonly string[] { return ids.includes(id) ? ids.filter((current) => current !== id) : [...ids, id] }
