import { FileText } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type {
  CorrespondenceAttachment,
  CorrespondenceMessage,
} from "@/lib/correspondence/types"

export function MessageCard({ projectId, message, viewerId, editDisabled, onEdit, onRetract }: {
  readonly projectId: string
  readonly message: CorrespondenceMessage
  readonly viewerId: string
  readonly editDisabled: boolean
  readonly onEdit: (message: CorrespondenceMessage) => Promise<void>
  readonly onRetract: (message: CorrespondenceMessage) => void
}): React.ReactElement {
  const initials = message.authorName.split(" ").map((part) => part[0]).join("").slice(0, 2)
  const openable = message.authorUserId !== viewerId && message.retractedAt === null
  // Observe the header so even messages taller than the viewport can be opened.
  return <article id={`correspondence-message-${message.id}`} className="border p-4 scroll-mt-48">
    <div data-correspondence-message-id={openable ? message.id : undefined} data-correspondence-message-edited-at={openable ? message.editedAt ?? undefined : undefined} className="flex items-start justify-between gap-3"><div className="flex min-w-0 gap-3"><Avatar><AvatarFallback>{initials}</AvatarFallback></Avatar><div className="min-w-0"><p className="font-medium">{message.authorName}</p><p className="text-sm text-muted-foreground"><time dateTime={message.sentAt}>{formatDate(message.sentAt)}</time>{message.editedAt !== null && " · Edited"}{message.retractedAt !== null && " · Retracted"}</p></div></div><Badge variant={message.delivery === "imported" ? "outline" : "secondary"}>{message.delivery === "imported" ? sourceName(message.source) : "Saved in Compass"}</Badge></div>
    <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Original headers</summary><div className="mt-2 border-l-2 pl-3 text-muted-foreground"><p>From: {message.authorName}</p><p>To: {recipientNames(message)}</p></div></details>
    {message.retractedAt === null ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{message.body}</p> : <p className="mt-3 text-sm italic text-muted-foreground">This message was retracted.</p>}
    {message.attachments.length > 0 && <ul className="mt-3 grid gap-2">{message.attachments.map((attachment) => <AttachmentRow key={attachment.id} projectId={projectId} attachment={attachment} />)}</ul>}
    {message.delivery === "imported" ? <p className="mt-3 text-xs text-muted-foreground">Original {sourceName(message.source)} message · Historical read status not available</p> : <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Delivery details</summary><ul className="mt-2 grid gap-1">{message.readReceipts.map((receipt) => <li key={receipt.userId}>{receipt.name} · {receiptLabel(receipt)}</li>)}</ul></details>}
    {message.canEdit && message.retractedAt === null && <div className="mt-3 flex gap-2"><Button variant="ghost" size="sm" disabled={editDisabled} onClick={() => void onEdit(message)}>Edit</Button><Button variant="ghost" size="sm" disabled={editDisabled} onClick={() => onRetract(message)}>Retract</Button></div>}
  </article>
}

function AttachmentRow({ projectId, attachment }: { readonly projectId: string; readonly attachment: CorrespondenceAttachment }): React.ReactElement {
  if (!attachment.available) return <li className="flex items-center gap-2 border px-3 py-2 text-sm text-muted-foreground"><FileText className="size-4" />{attachment.name}<span className="ml-auto">File unavailable</span></li>
  const href = `/api/correspondence/attachments/${encodeURIComponent(attachment.id)}?projectId=${encodeURIComponent(projectId)}`
  return <li><a className="flex items-center gap-2 border px-3 py-2 text-sm hover:bg-accent" href={href}><FileText className="size-4" /><span className="min-w-0 flex-1 truncate">{attachment.name}</span><span className="text-muted-foreground">{formatSize(attachment.size)}</span></a></li>
}

function recipientNames(message: CorrespondenceMessage): string { return message.recipients.length === 0 ? "Not available" : message.recipients.map((recipient) => `${recipient.kind.toUpperCase()}: ${recipient.name}`).join(" · ") }
function sourceName(source: CorrespondenceMessage["source"]): string { return source === "buildertrend" ? "Buildertrend" : source === "sms" ? "SMS" : source[0].toUpperCase() + source.slice(1) }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) }
function formatSize(size: number): string { return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB` }
function receiptLabel(receipt: CorrespondenceMessage["readReceipts"][number]): string { if (receipt.status === "unavailable") return "Read status unavailable"; if (receipt.status === "not_opened") return "Not opened"; return receipt.openedAt === null ? "Opened" : `Opened ${formatDate(receipt.openedAt)}` }
