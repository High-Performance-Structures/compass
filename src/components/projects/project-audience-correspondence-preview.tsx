"use client"

import * as React from "react"
import { getCorrespondenceDetail, searchCorrespondence } from "@/app/actions/project-correspondence"
import type { CorrespondenceDetail, CorrespondenceInbox } from "@/lib/correspondence/types"
import { MessageCard } from "@/components/correspondence/correspondence-message-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function ProjectAudienceCorrespondencePreview({ projectId, inbox }: {
  readonly projectId: string
  readonly inbox: CorrespondenceInbox
}): React.ReactElement {
  const [detail, setDetail] = React.useState<CorrespondenceDetail | null>(null)
  const [query, setQuery] = React.useState("")
  const [ids, setIds] = React.useState<readonly string[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const request = React.useRef(0)
  React.useEffect(() => {
    let active = true
    if (query.trim().length < 2) { setIds(null); return }
    const timer = window.setTimeout(() => {
      void searchCorrespondence(projectId, query).then((result) => {
        if (!active) return
        if (result.success) { setIds(result.data.hits.map((hit) => hit.conversationId)); setError(null) }
        else { setIds([]); setError(result.error) }
      })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [projectId, query])
  async function open(id: string, before?: number): Promise<void> {
    const version = ++request.current
    setError(null)
    if (before === undefined) setDetail(null)
    const result = await getCorrespondenceDetail(projectId, id, before)
    if (version !== request.current) return
    if (!result.success) { setError(result.error); return }
    setDetail((previous) => before === undefined || previous?.conversation.id !== id ? result.data : { ...result.data, messages: [...result.data.messages, ...previous.messages] })
  }
  const conversations = inbox.conversations.filter((item) => ids === null || ids.includes(item.id))
  return <div className="grid gap-4">
    <p className="text-sm text-muted-foreground">Read-only messages visible to the selected person. Opening a message does not mark it read.</p>
    <Input aria-label="Search this person's messages" placeholder="Search messages" value={query} onChange={(event) => setQuery(event.target.value)} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
      <nav aria-label="Conversations" className="divide-y border">
        {conversations.length === 0 && <p className="p-4 text-sm text-muted-foreground">No messages visible to this person.</p>}
        {conversations.map((item) => <button key={item.id} className="block w-full p-3 text-left hover:bg-muted" onClick={() => void open(item.id)}><span className="block text-sm font-medium">{item.subject}</span><span className="block truncate text-xs text-muted-foreground">{item.excerpt}</span></button>)}
      </nav>
      <section aria-label="Selected conversation" className="min-w-0 border p-4">
        {detail ? <><h2 className="text-base font-medium">{detail.conversation.subject}</h2>{detail.hasEarlier && <Button variant="outline" size="sm" onClick={() => void open(detail.conversation.id, detail.messages[0]?.sequence)}>Earlier messages</Button>}{detail.messages.map((message) => <MessageCard key={message.id} projectId={projectId} message={message} viewerId={inbox.viewerId} editDisabled readOnly onEdit={async () => undefined} onRetract={() => undefined} onRetryEmail={async () => undefined} />)}</> : <p className="text-sm text-muted-foreground">Choose a conversation.</p>}
      </section>
    </div>
  </div>
}
