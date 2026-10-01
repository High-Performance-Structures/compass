"use client"
import type { ProjectDraft } from "@/lib/correspondence/types"
export function ProjectDraftList(props: {
  readonly drafts: readonly ProjectDraft[]
  readonly query: string
  readonly busy: boolean
  readonly onOpen: (draft: ProjectDraft) => Promise<void>
}): React.ReactElement {
  const query = props.query.trim().toLocaleLowerCase()
  const visible = props.drafts.filter((draft) => {
    const content = "content" in draft ? draft.content : draft
    return `${content.subject} ${content.body}`.toLocaleLowerCase().includes(query)
  })
  return <div className="flex-1 overflow-y-auto" aria-label="Your private drafts">
    <p className="border-b px-4 py-3 text-xs text-muted-foreground">Only you can see these drafts. Open one to continue composing.</p>
    {visible.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No drafts. Start a new message or email to save one.</p> : visible.map((draft) => {
      const content = "content" in draft ? draft.content : draft
      const kind = "content" in draft ? draft.content.kind : "reply"
      const count = "content" in draft ? draft.attachments.length : draft.attachmentCount
      return <button key={draft.id} type="button" disabled={props.busy} className="block w-full border-b px-4 py-3 text-left hover:bg-muted/50" onClick={() => void props.onOpen(draft)}>
        <span className="flex justify-between gap-2 text-xs text-muted-foreground"><span>{kind === "email" ? "Email draft" : kind === "reply" ? "Reply draft" : "Message draft"}</span><time dateTime={draft.updatedAt}>{new Date(draft.updatedAt).toLocaleDateString(undefined, {month:"short",day:"numeric"})}</time></span>
        <span className="mt-1 block truncate text-sm font-medium">{content.subject || "(No subject)"}</span>
        <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">{content.body || "(No message yet)"}</span>
        {count > 0 && <span className="mt-1 block text-xs text-muted-foreground">{count} {count === 1 ? "attachment" : "attachments"}</span>}
      </button>
    })}
  </div>
}
