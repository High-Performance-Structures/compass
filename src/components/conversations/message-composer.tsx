"use client"

import * as React from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Link from "@tiptap/extension-link"
import Mention from "@tiptap/extension-mention"
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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { sendMessage } from "@/app/actions/chat-messages"
import { setTyping } from "@/app/actions/conversations-realtime"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
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
  readonly threadId?: string
  readonly placeholder?: string
  readonly onSent?: () => void
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

export function MessageComposer({
  channelId,
  channelName,
  organizationId,
  threadId,
  placeholder,
  onSent,
}: MessageComposerProps) {
  const router = useRouter()
  const { resolvedTheme } = useTheme()
  const emojiThemeVars = useEmojiThemeVars()
  const [isSending, setIsSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [showToolbar, setShowToolbar] = React.useState(false)
  const [emojiOpen, setEmojiOpen] = React.useState(false)

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
        blockquote: false,
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

    const content = editor.getText().trim()
    if (!content) return

    setIsSending(true)
    setError(null)

    try {
      const mentions = extractMentions(
        editor.getJSON() as Record<string, unknown>,
      )
      const contentHtml = editor.getHTML()

      const result = await sendMessage({
        channelId,
        content,
        contentHtml,
        threadId,
        mentions: mentions.length > 0 ? mentions : undefined,
      })

      if (result.success) {
        editor.commands.clearContent()
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
  }, [editor, channelId, threadId, router, onSent, isSending])

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
    </div>
  )
}
