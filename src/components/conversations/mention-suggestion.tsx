"use client"

import * as React from "react"
import { ReactRenderer, type Editor } from "@tiptap/react"
import tippy, { type Instance as TippyInstance } from "tippy.js"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Hash, Bot, Users } from "lucide-react"
import { searchMentionableUsers } from "@/app/actions/chat-messages"
import { cn } from "@/lib/utils"

type MentionItem = {
  readonly id: string
  readonly label: string
  readonly type: "group" | "agent" | "user"
  readonly avatarUrl?: string | null
}

type MentionListProps = {
  readonly items: readonly MentionItem[]
  readonly command: (item: { id: string; label: string }) => void
  readonly organizationId: string
}

const MentionList = React.forwardRef<
  { onKeyDown: (props: { event: KeyboardEvent }) => boolean },
  MentionListProps
>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = React.useState(0)

  const selectItem = React.useCallback(
    (index: number) => {
      const item = props.items[index]
      if (item) {
        props.command({ id: item.id, label: item.label })
      }
    },
    [props]
  )

  const upHandler = React.useCallback(() => {
    setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length)
  }, [selectedIndex, props.items.length])

  const downHandler = React.useCallback(() => {
    setSelectedIndex((selectedIndex + 1) % props.items.length)
  }, [selectedIndex, props.items.length])

  const enterHandler = React.useCallback(() => {
    selectItem(selectedIndex)
  }, [selectedIndex, selectItem])

  React.useEffect(() => {
    setSelectedIndex(0)
  }, [props.items])

  React.useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === "ArrowUp") {
        upHandler()
        return true
      }

      if (event.key === "ArrowDown") {
        downHandler()
        return true
      }

      if (event.key === "Enter" || event.key === "Tab") {
        enterHandler()
        return true
      }

      return false
    },
  }))

  if (props.items.length === 0) {
    return null
  }

  // group items by type
  const groups = props.items.filter((item) => item.type === "group")
  const agents = props.items.filter((item) => item.type === "agent")
  const people = props.items.filter((item) => item.type === "user")

  const getItemIndex = (item: MentionItem) => props.items.indexOf(item)

  return (
    <div className="max-h-[300px] overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
      {groups.length > 0 && (
        <div className="mb-1">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Groups
          </div>
          {groups.map((item) => {
            const index = getItemIndex(item)
            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                  index === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
                onClick={() => selectItem(index)}
              >
                <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
                  {item.id === "channel" ? (
                    <Hash className="h-3.5 w-3.5" />
                  ) : (
                    <Users className="h-3.5 w-3.5" />
                  )}
                </div>
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {agents.length > 0 && (
        <div className="mb-1">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Agents
          </div>
          {agents.map((item) => {
            const index = getItemIndex(item)
            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                  index === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
                onClick={() => selectItem(index)}
              >
                <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {people.length > 0 && (
        <div>
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            People
          </div>
          {people.map((item) => {
            const index = getItemIndex(item)
            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                  index === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
                onClick={() => selectItem(index)}
              >
                <Avatar className="h-6 w-6">
                  <AvatarImage src={item.avatarUrl ?? undefined} />
                  <AvatarFallback className="text-xs">
                    {item.label.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
})

MentionList.displayName = "MentionList"

export function createMentionSuggestion(organizationId: string) {
  return {
    items: async ({ query }: { query: string }) => {
      // static entries
      const staticItems: MentionItem[] = [
        { id: "channel", label: "channel", type: "group" },
        { id: "here", label: "here", type: "group" },
        { id: "compass-agent", label: "Compass", type: "agent" },
      ]

      // fetch users
      const usersResult = await searchMentionableUsers(query, organizationId)
      const userItems: MentionItem[] = usersResult.success && usersResult.data
        ? usersResult.data.map((user) => ({
            id: user.id,
            label: user.displayName ?? user.email,
            type: "user" as const,
            avatarUrl: user.avatarUrl,
          }))
        : []

      // combine and filter
      const allItems = [...staticItems, ...userItems]
      const lowerQuery = query.toLowerCase()

      if (!query) {
        return allItems
      }

      return allItems.filter((item) =>
        item.label.toLowerCase().includes(lowerQuery)
      )
    },

    render: () => {
      let component: ReactRenderer | null = null
      let popup: TippyInstance[] | null = null

      return {
        onStart: (props: unknown) => {
          const p = props as {
            editor: Editor
            clientRect: (() => DOMRect) | null
            items: readonly MentionItem[]
            command: (item: { id: string; label: string }) => void
          }

          component = new ReactRenderer(MentionList, {
            props: {
              ...p,
              organizationId,
            },
            editor: p.editor,
          })

          if (!p.clientRect) {
            return
          }

          popup = tippy("body", {
            getReferenceClientRect: p.clientRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
          })
        },

        onUpdate(props: unknown) {
          const p = props as {
            editor: Editor
            clientRect: (() => DOMRect) | null
            items: readonly MentionItem[]
            command: (item: { id: string; label: string }) => void
          }

          component?.updateProps({
            ...p,
            organizationId,
          })

          if (!p.clientRect) {
            return
          }

          popup?.[0]?.setProps({
            getReferenceClientRect: p.clientRect,
          })
        },

        onKeyDown(props: { event: KeyboardEvent }) {
          if (props.event.key === "Escape") {
            popup?.[0]?.hide()
            return true
          }

          const ref = component?.ref as { onKeyDown?: (props: { event: KeyboardEvent }) => boolean } | undefined
          return ref?.onKeyDown?.(props) ?? false
        },

        onExit() {
          popup?.[0]?.destroy()
          component?.destroy()
        },
      }
    },
  }
}
