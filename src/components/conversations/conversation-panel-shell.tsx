"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ExternalLink, MessageCircle, PanelRightClose, RefreshCw } from "lucide-react"
import { getConversationPanelData } from "@/app/actions/conversation-panel"
import { listChannels } from "@/app/actions/conversations"
import { DirectMessagePicker } from "@/components/conversations/direct-message-dialog"
import { MessageComposer } from "@/components/conversations/message-composer"
import { MessageList } from "@/components/conversations/message-list"
import { ConversationsProvider } from "@/contexts/conversations-context"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  conversationFullViewHref,
  conversationPanelOpenedAnnouncement,
} from "@/lib/conversations/notification-route"
import { isBuildertrendArchiveChannelId } from "@/lib/conversations/channel-access"
import { useConversationPanel } from "./conversation-panel-provider"

type PanelData = Extract<
  Awaited<ReturnType<typeof getConversationPanelData>>,
  { readonly success: true }
>["data"]

type TextChannel = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly projectId: string | null
  readonly type: string
}

function channelLabel(channel: TextChannel): string {
  return channel.projectId ? `Project · ${channel.name}` : channel.name
}

function ConversationPanelContent() {
  const router = useRouter()
  const { isOpen, channelId, view, open, close } = useConversationPanel()
  const [channels, setChannels] = React.useState<readonly TextChannel[]>([])
  const [channelsLoading, setChannelsLoading] = React.useState(false)
  const [channelsError, setChannelsError] = React.useState<string | null>(null)
  const [data, setData] = React.useState<PanelData | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [panelWidth, setPanelWidth] = React.useState(460)
  const [isResizing, setIsResizing] = React.useState(false)
  const dragStartX = React.useRef(0)
  const dragStartWidth = React.useRef(0)

  const loadChannels = React.useCallback(async () => {
    setChannelsLoading(true)
    setChannelsError(null)
    try {
      const result = await listChannels()
      if (!result.success || !result.data) {
        setChannelsError(
          result.success
            ? "Unable to load conversations."
            : result.error ?? "Unable to load conversations."
        )
        return
      }
      setChannels(result.data.filter((channel) => channel.type === "text"))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : ""
      setChannelsError(
        /server action|unrecognizedaction/i.test(message)
          ? "Compass was updated while this drawer was open. Reload to continue."
          : "Unable to load conversations."
      )
    } finally {
      setChannelsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (isOpen) void loadChannels()
  }, [isOpen, loadChannels])

  const loadConversation = React.useCallback(async (id: string) => {
    setLoading(true)
    setLoadError(null)
    setData(null)
    try {
      const result = await getConversationPanelData(id)
      if (!result.success || !result.data) {
        setLoadError(result.success ? "Unable to load this conversation." : result.error)
        return
      }
      setData(result.data)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : ""
      setLoadError(
        /server action|unrecognizedaction/i.test(message)
          ? "Compass was updated while this drawer was open. Reload to continue."
          : "Unable to load this conversation."
      )
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!isOpen || !channelId) {
      setData(null)
      setLoadError(null)
      return
    }
    void loadConversation(channelId)
  }, [channelId, isOpen, loadConversation])

  React.useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!dragStartWidth.current) return
      const delta = dragStartX.current - event.clientX
      setPanelWidth(Math.min(720, Math.max(320, dragStartWidth.current + delta)))
    }
    const onMouseUp = () => {
      if (!dragStartWidth.current) return
      dragStartWidth.current = 0
      setIsResizing(false)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [])

  const handleResizeStart = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    setIsResizing(true)
    dragStartX.current = event.clientX
    dragStartWidth.current = panelWidth
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [panelWidth])

  const showDirectMessagePicker = view === "direct-message-picker"
  const showChannelList = channelId === null && !showDirectMessagePicker

  return (
    <>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {isOpen && channelId ? conversationPanelOpenedAnnouncement() : ""}
      </p>
      <section
        className={cn(
          "flex flex-col bg-background",
          "transition-[width,border-color,box-shadow,opacity,transform] duration-300 ease-in-out",
          "fixed inset-0 z-50 md:relative md:inset-auto md:z-auto md:my-2 md:mr-2 md:shrink-0 md:overflow-hidden md:rounded-lg md:border md:border-border md:shadow-lg",
          isResizing && "transition-none",
          isOpen
            ? "translate-x-0 md:opacity-100"
            : "pointer-events-none translate-x-full md:translate-x-0 md:w-0 md:border-transparent md:shadow-none md:opacity-0"
        )}
        style={isOpen ? { width: panelWidth } : undefined}
        aria-hidden={!isOpen}
        aria-label="Conversations"
      >
        <div
          className="absolute -left-1 top-0 z-10 hidden h-full w-2 cursor-col-resize md:block hover:bg-border/60 active:bg-border"
          onMouseDown={handleResizeStart}
        />
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
          {channelId || showDirectMessagePicker ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => open(null)}
              aria-label="Choose another conversation"
              title="All conversations"
            >
              <ArrowLeft className="size-4" />
            </Button>
          ) : (
            <MessageCircle className="ml-1 size-4 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">
              {data
                ? `# ${data.channel.name}`
                : showDirectMessagePicker
                  ? "New direct message"
                  : "Conversations"}
            </h2>
            {data?.channel.description ? (
              <p className="truncate text-xs text-muted-foreground">
                {data.channel.description}
              </p>
            ) : null}
          </div>
          {channelId ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                close()
                router.push(conversationFullViewHref(channelId))
              }}
              aria-label="Open conversation in center"
              title="Open in center"
            >
              <ExternalLink className="size-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={close}
            aria-label="Collapse conversations"
            title="Collapse conversations"
          >
            <PanelRightClose className="size-4" />
          </Button>
        </header>

        {showDirectMessagePicker ? (
          <DirectMessagePicker onStarted={(channelId) => open(channelId)} />
        ) : showChannelList ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="mb-3 text-xs text-muted-foreground">
              Open a team or project conversation without leaving this workspace.
            </p>
            {channelsLoading ? (
              <p className="p-3 text-sm text-muted-foreground">Loading conversations...</p>
            ) : channelsError ? (
              <div className="space-y-3 p-3 text-center">
                <p className="text-sm text-muted-foreground">{channelsError}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => void loadChannels()}>
                  <RefreshCw className="size-3.5" />
                  Try again
                </Button>
              </div>
            ) : channels.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No conversations are available.</p>
            ) : (
              <div className="space-y-1">
                {channels.map((channel) => (
                  <button
                    key={channel.id}
                    type="button"
                    className="flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => open(channel.id)}
                  >
                    <span className="truncate text-sm font-medium"># {channel.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {channel.description ?? channelLabel(channel)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">Loading conversation...</p>
          </div>
        ) : loadError ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => channelId && void loadConversation(channelId)}>
              <RefreshCw className="size-3.5" />
              Try again
            </Button>
          </div>
        ) : data ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <MessageList
              channelId={data.channel.id}
              initialMessages={data.messages}
              showThreadActions={false}
            />
            {data.channel.archivedAt ? (
              <div className="border-t bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                This conversation is archived.
              </div>
            ) : isBuildertrendArchiveChannelId(data.channel.id) ? (
              <div className="border-t bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                Open this conversation in the center to reply within an archived
                Buildertrend message thread. Replies stay internal; mention a teammate
                to notify them.
              </div>
            ) : (
              <MessageComposer
                channelId={data.channel.id}
                channelName={data.channel.name}
                organizationId={data.channel.organizationId}
                isProjectChannel={Boolean(data.channel.projectId)}
                projectRecipients={data.projectRecipients}
                onSent={() => void loadConversation(data.channel.id)}
              />
            )}
          </div>
        ) : null}
      </section>
      {isOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      ) : null}
    </>
  )
}

export function ConversationPanelShell() {
  return (
    <ConversationsProvider wrap={false}>
      <ConversationPanelContent />
    </ConversationsProvider>
  )
}
