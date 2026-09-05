import { Archive, Check, MoreHorizontal, Star } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  CorrespondenceStateInput,
  CorrespondenceSummary,
} from "@/lib/correspondence/types"

export function SearchResults({ hits, hasMore, onOpen }: {
  readonly hits: readonly { readonly conversationId: string; readonly messageId: string; readonly subject: string; readonly excerpt: string; readonly sentAt: string; readonly sourceSentDisplay?: string | null; readonly sourceSentAt?: string | null }[]
  readonly hasMore: boolean
  readonly onOpen: (conversationId: string, messageId: string) => void
}): React.ReactElement {
  if (hits.length === 0) return <p className="p-5 text-sm text-muted-foreground">No authorized messages match this search.</p>
  return <div>{hits.map((hit) => <button key={hit.messageId} type="button" onClick={() => onOpen(hit.conversationId, hit.messageId)} className="w-full border-b px-4 py-3 text-left hover:bg-accent"><p className="truncate font-medium">{hit.subject}</p><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{hit.excerpt}</p>{unknownSourceSearchLabel(hit) === null ? <time className="mt-1 block text-xs text-muted-foreground" dateTime={hit.sentAt}>{formatSearchTime(hit.sentAt)}</time> : <span className="mt-1 block text-xs text-muted-foreground" title="Source-local timestamp; timezone not proven">Source time: {unknownSourceSearchLabel(hit)}</span>}</button>)}{hasMore && <p className="p-4 text-xs text-muted-foreground">Refine your search to narrow these results.</p>}</div>
}

export function ConversationMenu({
  conversation,
  workspace,
  onState,
  onClosed,
  onReceiptPreference,
}: {
  readonly conversation: CorrespondenceSummary
  readonly workspace: "staff" | "owner" | "sub_vendor"
  readonly onState: (state: CorrespondenceStateInput) => Promise<void>
  readonly onClosed: () => Promise<void>
  readonly onReceiptPreference: (share: boolean) => Promise<void>
}): React.ReactElement {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Conversation actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => void onState({ saved: !conversation.saved, followUp: conversation.followUp, archived: conversation.archived })}><Star />{conversation.saved ? "Remove from saved" : "Save conversation"}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void onState({ saved: conversation.saved, followUp: !conversation.followUp, archived: conversation.archived })}><Check />{conversation.followUp ? "Clear follow-up" : "Flag for follow-up"}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void onState({ saved: conversation.saved, followUp: conversation.followUp, archived: !conversation.archived })}><Archive />{conversation.archived ? "Restore from archive" : "Archive conversation"}</DropdownMenuItem>
      <DropdownMenuCheckboxItem checked={conversation.shareReadReceipts} onCheckedChange={(share) => void onReceiptPreference(share === true)}>Share when I open messages</DropdownMenuCheckboxItem>
      {workspace === "staff" && <DropdownMenuItem onSelect={() => void onClosed()}>{conversation.closed ? "Reopen conversation" : "Close conversation"}</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>
}

export function ConversationTags({ conversation }: { readonly conversation: CorrespondenceSummary }): React.ReactElement | null {
  if (!conversation.followUp && !conversation.saved && !conversation.archived && !conversation.closed) return null
  return <div className="mt-2 flex gap-2 text-xs text-muted-foreground">{conversation.followUp && <span>Needs reply</span>}{conversation.saved && <span>Saved</span>}{conversation.archived && <span>Archived</span>}{conversation.closed && <span>Closed</span>}</div>
}

export function EmptyDetail(): React.ReactElement {
  return <div className="flex min-h-full items-center justify-center p-6 text-center"><div><h2 className="font-semibold">Select a conversation</h2><p className="mt-1 text-sm text-muted-foreground">Choose a subject to read the authorized correspondence.</p></div></div>
}

function formatSearchTime(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString([], { month: "short", day: "numeric" }) }
function unknownSourceSearchLabel(hit: { readonly sourceSentDisplay?: string | null; readonly sourceSentAt?: string | null }): string | null { return hit.sourceSentAt === null && hit.sourceSentDisplay !== null && hit.sourceSentDisplay !== undefined ? hit.sourceSentDisplay : null }
