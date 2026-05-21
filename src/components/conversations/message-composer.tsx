"use client"

import * as React from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Link from "@tiptap/extension-link"
import Mention from "@tiptap/extension-mention"
import { Markdown } from "tiptap-markdown"
import {
  Bold,
  Italic,
  Code,
  List,
  ListOrdered,
  Plus,
  Smile,
  Sticker,
  Gift,
  SendToBack,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { sendMessage } from "@/app/actions/chat-messages"
import {
  sendProjectMessage,
  type ProjectMessageRecipient,
} from "@/app/actions/project-messages"
import { setTyping } from "@/app/actions/conversations-realtime"
import { useRouter } from "next/navigation"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import { createMentionSuggestion } from "./mention-suggestion"

// lazy-load emoji picker to keep initial bundle small
const EmojiPicker = React.lazy(() =>
  import("@emoji-mart/react").then((mod) => ({ default: mod.default })),
)

type EmojiData = {
  readonly native: string
}

/** read a CSS custom property and resolve it to an "R, G, B" string */
function cssVarToRgb(varName: string): string | null {
  if (typeof window === "undefined") return null
  const style = getComputedStyle(document.documentElement)
  const raw = style.getPropertyValue(varName).trim()
  if (!raw) return null

  // create a temporary element to resolve the color
  const el = document.createElement("div")
  el.style.color = raw
  document.body.appendChild(el)
  const computed = getComputedStyle(el).color
  document.body.removeChild(el)

  // computed is like "rgb(R, G, B)" or "rgba(R, G, B, A)"
  const match = computed.match(
    /rgba?\(\s*([\d.]+),?\s*([\d.]+),?\s*([\d.]+)/,
  )
  if (!match) return null
  return `${Math.round(Number(match[1]))}, ${Math.round(Number(match[2]))}, ${Math.round(Number(match[3]))}`
}

function useEmojiThemeVars(): Record<string, string> {
  const [vars, setVars] = React.useState<Record<string, string>>({})
  const { resolvedTheme } = useTheme()

  React.useEffect(() => {
    const bg = cssVarToRgb("--popover")
    const fg = cssVarToRgb("--popover-foreground")
    const input = cssVarToRgb("--muted")
    const next: Record<string, string> = {}
    if (bg) next["--em-rgb-background"] = bg
    if (fg) next["--em-rgb-color"] = fg
    if (input) next["--em-rgb-input"] = input
    setVars(next)
  }, [resolvedTheme])

  return vars
}

type MessageComposerProps = {
  readonly channelId: string
  readonly channelName: string
  readonly organizationId: string
  readonly projectRecipients?: readonly ProjectRecipientContact[]
  readonly threadId?: string
  readonly placeholder?: string
  readonly onSent?: () => void
}

export type ProjectRecipientContact = {
  readonly id: string
  readonly contactType: "owner" | "supplier" | "subcontractor" | "internal"
  readonly displayName: string
  readonly companyName: string | null
  readonly role: string | null
  readonly trade: string | null
  readonly email: string | null
}

type MentionInput = {
  mentionType: "user" | "channel" | "here" | "agent"
  targetId: string | null
}

function extractMentions(
  json: Record<string, unknown>,
): Array<MentionInput> {
  const mentions: Array<MentionInput> = []

  function walk(node: Record<string, unknown>) {
    if (node.type === "mention" && node.attrs) {
      const attrs = node.attrs as Record<string, string>
      const id = attrs.id

      if (id === "channel") {
        mentions.push({ mentionType: "channel", targetId: null })
      } else if (id === "here") {
        mentions.push({ mentionType: "here", targetId: null })
      } else if (id === "compass-agent") {
        mentions.push({
          mentionType: "agent",
          targetId: "compass-agent",
        })
      } else {
        mentions.push({ mentionType: "user", targetId: id })
      }
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        walk(child as Record<string, unknown>)
      }
    }
  }

  walk(json)
  return mentions
}

function contactLabel(contact: ProjectRecipientContact): string {
  const detail = contact.companyName ?? contact.trade ?? contact.role
  return detail ? `${contact.displayName} - ${detail}` : contact.displayName
}

function recipientFromValue(value: string): ProjectMessageRecipient {
  if (value === "internal") return { kind: "internal" }
  if (value === "owners") return { kind: "owners" }
  if (value === "sub_vendors") return { kind: "sub_vendors" }
  if (value.startsWith("contact:")) {
    return { kind: "contact", contactId: value.slice("contact:".length) }
  }
  return { kind: "channel" }
}

function recipientDetail(
  value: string,
  contacts: readonly ProjectRecipientContact[]
): string {
  if (value === "channel") {
    return "Posts only to this channel history."
  }
  if (value === "internal") {
    const count = contacts.filter(
      (contact) => contact.contactType === "internal"
    ).length
    return `${count} internal project contact${count === 1 ? "" : "s"} selected.`
  }
  if (value === "owners") {
    const count = contacts.filter(
      (contact) => contact.contactType === "owner"
    ).length
    return `${count} owner contact${count === 1 ? "" : "s"} selected.`
  }
  if (value === "sub_vendors") {
    const count = contacts.filter(
      (contact) =>
        contact.contactType === "supplier" ||
        contact.contactType === "subcontractor"
    ).length
    return `${count} sub/vendor contact${count === 1 ? "" : "s"} selected.`
  }
  if (value.startsWith("contact:")) {
    const contactId = value.slice("contact:".length)
    const contact = contacts.find((item) => item.id === contactId)
    return contact?.email
      ? `Targets ${contact.email}.`
      : "This contact does not have an email yet."
  }
  return "Posts to this channel."
}

function groupLabel(contactType: ProjectRecipientContact["contactType"]): string {
  switch (contactType) {
    case "owner":
      return "Owners"
    case "supplier":
      return "Suppliers"
    case "subcontractor":
      return "Subcontractors"
    case "internal":
      return "Internal"
  }
}

export function MessageComposer({
  channelId,
  channelName,
  organizationId,
  projectRecipients = [],
  threadId,
  placeholder,
  onSent,
}: MessageComposerProps) {
  const router = useRouter()
  const { resolvedTheme } = useTheme()
  const emojiThemeVars = useEmojiThemeVars()
  const [isSending, setIsSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [deliveryNote, setDeliveryNote] = React.useState<string | null>(null)
  const [showToolbar, setShowToolbar] = React.useState(false)
  const [emojiOpen, setEmojiOpen] = React.useState(false)
  const [recipientValue, setRecipientValue] = React.useState("channel")
  const hasProjectRecipients = projectRecipients.length > 0 && !threadId

  const lastTypingSentRef = React.useRef<number>(0)
  const TYPING_DEBOUNCE_MS = 3000

  const sendTypingIndicator = React.useCallback(() => {
    const now = Date.now()
    if (now - lastTypingSentRef.current >= TYPING_DEBOUNCE_MS) {
      lastTypingSentRef.current = now
      setTyping(channelId).catch((err) => {
        console.error(
          "[MessageComposer] typing indicator error:",
          err,
        )
      })
    }
  }, [channelId])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
      }),
      Markdown.configure({
        transformPastedText: true,
        transformCopiedText: true,
      }),
      Placeholder.configure({
        placeholder: placeholder ?? `Message #${channelName}`,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-primary underline underline-offset-2",
        },
      }),
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        suggestion: createMentionSuggestion(organizationId),
        renderText({ node }) {
          return `@${node.attrs.label ?? node.attrs.id}`
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none focus:outline-none",
          "min-h-[22px] py-[11px] px-0",
          "text-sm leading-[22px]",
        ),
      },
    },
    onUpdate: () => {
      setError(null)
      sendTypingIndicator()
    },
  })

  const groupedContacts = React.useMemo(() => {
    const groups = new Map<
      ProjectRecipientContact["contactType"],
      ProjectRecipientContact[]
    >()
    for (const contact of projectRecipients) {
      const existing = groups.get(contact.contactType) ?? []
      existing.push(contact)
      groups.set(contact.contactType, existing)
    }
    return groups
  }, [projectRecipients])

  const handleEmojiSelect = React.useCallback(
    (emoji: EmojiData) => {
      if (!editor) return
      editor.chain().focus().insertContent(emoji.native).run()
      setEmojiOpen(false)
    },
    [editor],
  )

  const handleSend = React.useCallback(async () => {
    if (!editor || isSending) return

    const plainText = editor.getText().trim()
    if (!plainText) return

    setIsSending(true)
    setError(null)
    setDeliveryNote(null)

    try {
      const mentions = extractMentions(
        editor.getJSON() as Record<string, unknown>,
      )
      // send markdown so the server renders it via `marked`
      const storage = editor.storage as unknown as Record<
        string,
        { getMarkdown?: () => string } | undefined
      >
      const markdown = storage.markdown?.getMarkdown?.() ?? plainText

      const result =
        recipientValue === "channel" || threadId
          ? await sendMessage({
              channelId,
              content: markdown,
              threadId,
              mentions: mentions.length > 0 ? mentions : undefined,
            })
          : await sendProjectMessage({
              channelId,
              content: markdown,
              recipient: recipientFromValue(recipientValue),
              mentions: mentions.length > 0 ? mentions : undefined,
            })

      if (result.success) {
        editor.commands.clearContent()
        if ("data" in result && result.data && "recipientLabel" in result.data) {
          const noteParts = [`Sent to ${result.data.recipientLabel}`]
          if (result.data.notifiedUserCount > 0) {
            noteParts.push(
              `${result.data.notifiedUserCount} Compass user${
                result.data.notifiedUserCount === 1 ? "" : "s"
              } notified`
            )
          }
          if (result.data.unmatchedContactCount > 0) {
            noteParts.push(
              `${result.data.unmatchedContactCount} contact${
                result.data.unmatchedContactCount === 1 ? "" : "s"
              } still need Compass login/email matching`
            )
          }
          setDeliveryNote(`${noteParts.join(". ")}.`)
        } else {
          setDeliveryNote("Sent to the channel.")
        }
        router.refresh()
        onSent?.()
      } else {
        setError(result.error ?? "Failed to send message")
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send message",
      )
    } finally {
      setIsSending(false)
    }
  }, [
    editor,
    channelId,
    threadId,
    router,
    onSent,
    isSending,
    recipientValue,
  ])

  React.useEffect(() => {
    if (!editor) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        handleSend()
      }
    }

    const editorElement = editor.view.dom
    editorElement.addEventListener("keydown", handleKeyDown)

    return () => {
      editorElement.removeEventListener("keydown", handleKeyDown)
    }
  }, [editor, handleSend])

  return (
    <div className="min-h-[68px] px-2 pb-4 pt-2 sm:px-4">
      {hasProjectRecipients && (
        <div className="mb-2 flex flex-col gap-2 rounded-lg border bg-background/80 px-3 py-2 shadow-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SendToBack className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Send to
                </span>
                <Select
                  value={recipientValue}
                  onValueChange={setRecipientValue}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-8 w-[220px] bg-background"
                    aria-label="Message recipient"
                  >
                    <SelectValue placeholder="Choose recipient" />
                  </SelectTrigger>
                  <SelectContent align="start" className="max-h-80">
                    <SelectItem value="channel">Project channel only</SelectItem>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Project groups</SelectLabel>
                      <SelectItem value="internal">Internal team</SelectItem>
                      <SelectItem value="owners">Owner team</SelectItem>
                      <SelectItem value="sub_vendors">Subs/vendors</SelectItem>
                    </SelectGroup>
                    <SelectSeparator />
                    {Array.from(groupedContacts.entries()).map(
                      ([contactType, contacts]) => (
                        <SelectGroup key={contactType}>
                          <SelectLabel>{groupLabel(contactType)}</SelectLabel>
                          {contacts.map((contact) => (
                            <SelectItem
                              key={contact.id}
                              value={`contact:${contact.id}`}
                            >
                              {contactLabel(contact)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )
                    )}
                  </SelectContent>
                </Select>
                <Badge variant="outline" className="rounded-md">
                  #{channelName}
                </Badge>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {recipientDetail(recipientValue, projectRecipients)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* formatting toolbar */}
      {editor && showToolbar && (
        <div className="mb-1.5 flex items-center gap-0.5 pl-10 sm:pl-12">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={() =>
              editor.chain().focus().toggleBold().run()
            }
            disabled={
              !editor.can().chain().focus().toggleBold().run()
            }
          >
            <Bold
              className={cn(
                "h-3.5 w-3.5",
                editor.isActive("bold") && "text-primary",
              )}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={() =>
              editor.chain().focus().toggleItalic().run()
            }
            disabled={
              !editor.can().chain().focus().toggleItalic().run()
            }
          >
            <Italic
              className={cn(
                "h-3.5 w-3.5",
                editor.isActive("italic") && "text-primary",
              )}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={() =>
              editor.chain().focus().toggleCode().run()
            }
            disabled={
              !editor.can().chain().focus().toggleCode().run()
            }
          >
            <Code
              className={cn(
                "h-3.5 w-3.5",
                editor.isActive("code") && "text-primary",
              )}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={() =>
              editor.chain().focus().toggleBulletList().run()
            }
          >
            <List
              className={cn(
                "h-3.5 w-3.5",
                editor.isActive("bulletList") && "text-primary",
              )}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={() =>
              editor.chain().focus().toggleOrderedList().run()
            }
          >
            <ListOrdered
              className={cn(
                "h-3.5 w-3.5",
                editor.isActive("orderedList") && "text-primary",
              )}
            />
          </Button>
        </div>
      )}

      {/* main composer bar */}
      <div
        className={cn(
          "relative flex items-end rounded-lg",
          "bg-muted/50 ring-1 ring-border",
          "focus-within:ring-2 focus-within:ring-ring",
          "transition-shadow",
        )}
      >
        {/* + button */}
        <button
          type="button"
          className={cn(
            "flex h-[44px] w-[44px] shrink-0 items-center justify-center",
            "text-muted-foreground",
            "hover:text-foreground transition-colors",
          )}
          onClick={() => setShowToolbar((prev) => !prev)}
          aria-label="Toggle formatting"
        >
          <Plus
            className={cn(
              "h-5 w-5 transition-transform duration-200",
              showToolbar && "rotate-45",
            )}
          />
        </button>

        {/* editor area */}
        <EditorContent
          editor={editor}
          className="composer-editor min-w-0 flex-1"
        />

        {/* right-side action icons */}
        <div className="flex h-[44px] shrink-0 items-center gap-0 pr-1 sm:pr-1.5">
          <button
            type="button"
            className={cn(
              "hidden sm:flex",
              "h-8 w-8 items-center justify-center rounded-md",
              "text-muted-foreground hover:text-foreground transition-colors",
            )}
            aria-label="Stickers"
          >
            <Sticker className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            className={cn(
              "hidden sm:flex",
              "h-8 w-8 items-center justify-center rounded-md",
              "text-muted-foreground hover:text-foreground transition-colors",
            )}
            aria-label="GIF"
          >
            <Gift className="h-[18px] w-[18px]" />
          </button>

          {/* emoji picker */}
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md",
                  "text-muted-foreground hover:text-foreground transition-colors",
                  emojiOpen && "text-foreground",
                )}
                aria-label="Emoji"
              >
                <Smile className="h-[18px] w-[18px]" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              sideOffset={8}
              className="w-auto border-none bg-transparent p-0 shadow-none"
            >
              <React.Suspense
                fallback={
                  <div className="flex h-[350px] w-[352px] items-center justify-center rounded-lg border bg-popover">
                    <p className="text-sm text-muted-foreground">
                      Loading...
                    </p>
                  </div>
                }
              >
                <div style={emojiThemeVars as React.CSSProperties}>
                  <EmojiPicker
                    onEmojiSelect={handleEmojiSelect}
                    theme={resolvedTheme === "dark" ? "dark" : "light"}
                    set="native"
                    skinTonePosition="search"
                    previewPosition="none"
                    maxFrequentRows={2}
                  />
                </div>
              </React.Suspense>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {error && (
        <p className="mt-1.5 text-xs text-destructive">{error}</p>
      )}
      {deliveryNote && !error && (
        <p className="mt-1.5 text-xs text-muted-foreground">{deliveryNote}</p>
      )}
    </div>
  )
}
