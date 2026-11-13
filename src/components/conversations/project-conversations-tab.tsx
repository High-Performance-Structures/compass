import Link from "next/link"

import { getChannel } from "@/app/actions/conversations"
import { getProjectConversations } from "@/app/actions/project-conversations"
import { ChannelView } from "@/components/conversations/channel-view"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { AuthUser } from "@/lib/auth"
import {
  projectConversationFilter,
  projectConversationScope,
  type ProjectConversationFilter,
  type ProjectConversationRow,
  type ProjectConversationScope,
} from "@/lib/domain/conversations/project-conversations"
import { formatRelativeDate } from "@/lib/file-utils"
import { cn } from "@/lib/utils"

/*
 * The Conversations tab of a job's Messages page, for staff and for owners
 * and vendors in their workspace. The list is the job's conversations only;
 * the open one renders beside it. Every choice lives in the URL so links,
 * Back and refresh keep the same view.
 */

export type ProjectConversationsQuery = {
  readonly scope: ProjectConversationScope
  readonly filter: ProjectConversationFilter
  readonly search: string
  readonly page: number
  readonly channelId: string | null
}

type SearchValue = string | readonly string[] | undefined

function firstValue(value: SearchValue): string | undefined {
  return typeof value === "string" ? value : value?.[0]
}

/** The Conversations tab's choices from a Messages page URL, or null when the Emails tab is showing. */
export function projectConversationsQueryFromSearch(search: {
  readonly view?: SearchValue
  readonly scope?: SearchValue
  readonly filter?: SearchValue
  readonly q?: SearchValue
  readonly page?: SearchValue
  readonly channel?: SearchValue
}): ProjectConversationsQuery | null {
  if (firstValue(search.view) !== "conversations") return null
  return {
    scope: projectConversationScope(firstValue(search.scope)),
    filter: projectConversationFilter(firstValue(search.filter)),
    search: (firstValue(search.q) ?? "").slice(0, 200),
    page: Number(firstValue(search.page)) || 1,
    channelId: firstValue(search.channel) ?? null,
  }
}

const STAFF_FILTERS: ReadonlyArray<{ readonly value: ProjectConversationFilter; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "staff", label: "Staff only" },
  { value: "owners", label: "With owners" },
  { value: "vendors", label: "With vendors" },
  { value: "imported", label: "Imported history" },
]

const AUDIENCE_LABEL: Readonly<Record<string, string>> = {
  staff: "Staff only",
  clients: "Owners",
  sub_vendors: "Vendors",
  organization: "Company",
}

export function projectConversationsHref(
  basePath: string,
  query: ProjectConversationsQuery,
  extra: Readonly<Record<string, string>> = {},
): string {
  const params = new URLSearchParams(extra)
  if (query.scope === "global") params.set("scope", "global")
  if (query.filter !== "all") params.set("filter", query.filter)
  if (query.search) params.set("q", query.search)
  if (query.page > 1) params.set("page", String(query.page))
  if (query.channelId) params.set("channel", query.channelId)
  const search = params.toString()
  return search ? `${basePath}?${search}` : basePath
}

export async function ProjectConversationsTab({
  projectId,
  basePath,
  baseParams = {},
  query,
  currentUser,
  channelHref,
}: {
  readonly projectId: string
  /** The Messages page this tab sits on. */
  readonly basePath: string
  /** Query values that keep this tab selected, such as view=conversations. */
  readonly baseParams?: Readonly<Record<string, string>>
  readonly query: ProjectConversationsQuery
  readonly currentUser: AuthUser | null
  /** Open conversations on their own page (owner and vendor workspaces) instead of beside the list. */
  readonly channelHref?: (channelId: string) => string
}) {
  const result = await getProjectConversations(projectId, {
    scope: query.scope,
    filter: query.filter,
    search: query.search,
    page: query.page,
  })
  const selected = query.channelId && !channelHref && currentUser ? await getChannel(query.channelId) : null
  const channel =
    selected?.success && selected.data && selected.data.projectId === projectId
      ? selected.data
      : null
  const href = (change: Partial<ProjectConversationsQuery>) =>
    projectConversationsHref(basePath, { ...query, ...change }, baseParams)

  if (!result.success) {
    return <p className="p-6 text-sm text-muted-foreground">Conversations are unavailable. {result.error}</p>
  }
  const data = result.data
  const isStaff = data.viewerIsInternal

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        aria-label="Job conversations"
        className={cn(
          "flex w-full shrink-0 flex-col overflow-y-auto",
          !channelHref && "border-r md:w-[26rem]",
          channel && "hidden md:flex",
        )}
      >
        <div className="space-y-3 border-b p-4">
          {isStaff && (
            <nav aria-label="Conversation views" className="flex flex-wrap gap-1">
              <Button asChild size="sm" variant={data.scope === "mine" ? "secondary" : "ghost"}>
                <Link href={href({ scope: "mine", page: 1, channelId: null })} aria-current={data.scope === "mine" ? "page" : undefined}>
                  My conversations
                </Link>
              </Button>
              <Button asChild size="sm" variant={data.scope === "global" ? "secondary" : "ghost"}>
                <Link href={href({ scope: "global", page: 1, channelId: null })} aria-current={data.scope === "global" ? "page" : undefined}>
                  Global
                </Link>
              </Button>
            </nav>
          )}
          {isStaff && (
            <nav aria-label="Conversation filters" className="flex flex-wrap gap-1">
              {STAFF_FILTERS.map((filter) => (
                <Button key={filter.value} asChild size="xs" variant={query.filter === filter.value ? "secondary" : "outline"}>
                  <Link href={href({ filter: filter.value, page: 1, channelId: null })} aria-current={query.filter === filter.value ? "page" : undefined}>
                    {filter.label}
                  </Link>
                </Button>
              ))}
            </nav>
          )}
          <form action={basePath} className="flex gap-2">
            {Object.entries(baseParams).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            {data.scope === "global" && <input type="hidden" name="scope" value="global" />}
            {query.filter !== "all" && <input type="hidden" name="filter" value={query.filter} />}
            <Input
              type="search"
              name="q"
              defaultValue={query.search}
              maxLength={200}
              aria-label="Search this job's conversations"
              placeholder="Search subject or message text"
            />
            <Button type="submit" size="sm" variant="outline">Search</Button>
          </form>
        </div>
        {data.rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {query.search
              ? "No conversations match that search."
              : isStaff && data.scope === "mine"
                ? "You aren't in any of this job's conversations yet. Choose Global to see them all."
                : "No conversations yet."}
          </p>
        ) : (
          <ul className="divide-y">
            {data.rows.map((row) => (
              <li key={row.id}>
                <ConversationRow row={row} isStaff={isStaff} selected={row.id === channel?.id} href={channelHref ? channelHref(row.id) : href({ channelId: row.id })} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
          <span>{data.total} {data.total === 1 ? "conversation" : "conversations"}</span>
          {data.pageCount > 1 && (
            <span className="flex items-center gap-2">
              {data.page > 1 && <Link className="underline" href={href({ page: data.page - 1, channelId: null })}>Previous</Link>}
              <span>Page {data.page} of {data.pageCount}</span>
              {data.page < data.pageCount && <Link className="underline" href={href({ page: data.page + 1, channelId: null })}>Next</Link>}
            </span>
          )}
        </div>
      </aside>
      {!channelHref && <section aria-label="Open conversation" className={cn("min-w-0 flex-1", !channel && "hidden md:flex")}>
        {channel && currentUser ? (
          <div className="flex h-full min-h-0 w-full flex-col">
            <div className="border-b px-4 py-2 md:hidden">
              <Link className="text-sm underline" href={href({ channelId: null })}>Back to conversations</Link>
            </div>
            <div className="min-h-0 flex-1">
              <ChannelView channel={channel} currentUser={currentUser} />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <div>
              <p className="text-sm font-medium">Select a conversation</p>
              <p className="mt-1 text-xs text-muted-foreground">Choose one on the left to read and reply.</p>
            </div>
          </div>
        )}
      </section>}
    </div>
  )
}

function ConversationRow({
  row,
  isStaff,
  selected,
  href,
}: {
  readonly row: ProjectConversationRow
  readonly isStaff: boolean
  readonly selected: boolean
  readonly href: string
}) {
  const unread = row.unreadCount > 0
  return (
    <Link
      href={href}
      aria-current={selected ? "page" : undefined}
      className={cn("block px-4 py-3 hover:bg-accent/50", selected && "bg-accent")}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={cn("min-w-0 truncate text-sm", unread && "font-semibold")}>
          {unread && <span className="sr-only">Unread. </span>}
          {row.name}
          {isStaff && row.imported && <span className="ml-1.5 border px-1 text-[10px] text-muted-foreground">BT</span>}
        </p>
        <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeDate(row.lastActivityAt)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {row.lastText ? `${row.lastSender ? `${row.lastSender}: ` : ""}${row.lastText}` : "No messages yet"}
        </p>
        <span className="flex shrink-0 items-center gap-1.5">
          {unread && <Badge className="h-5 px-1.5 text-[10px]">{row.unreadCount}</Badge>}
          {isStaff && <Badge variant="outline" className="text-[10px]">{AUDIENCE_LABEL[row.audience] ?? row.audience}</Badge>}
        </span>
      </div>
    </Link>
  )
}
