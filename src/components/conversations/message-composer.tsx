"use client"

import * as React from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Link from "@tiptap/extension-link"
import Mention from "@tiptap/extension-mention"
import { Bold, Italic, Code, Link as LinkIcon, List, ListOrdered, Send, Paperclip, Smile } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { sendMessage } from "@/app/actions/chat-messages"
import { setTyping } from "@/app/actions/conversations-realtime"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { createMentionSuggestion } from "./mention-suggestion"

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

function extractMentions(json: Record<string, unknown>): Array<MentionInput> {
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
        mentions.push({ mentionType: "agent", targetId: "compass-agent" })
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
  const [isSending, setIsSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // typing indicator - debounce to avoid spamming server
  const lastTypingSentRef = React.useRef<number>(0)
  const TYPING_DEBOUNCE_MS = 3000

  const sendTypingIndicator = React.useCallback(() => {
    const now = Date.now()
    if (now - lastTypingSentRef.current >= TYPING_DEBOUNCE_MS) {
      lastTypingSentRef.current = now
      setTyping(channelId).catch((err) => {
        console.error("[MessageComposer] typing indicator error:", err)
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
        placeholder: placeholder ?? `Message #${channelName}...`,
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
        class: "prose prose-sm max-w-none focus:outline-none min-h-[80px] p-3",
      },
    },
    onUpdate: () => {
      setError(null)
      sendTypingIndicator()
    },
  })

  const handleSend = React.useCallback(async () => {
    if (!editor || isSending) return

    const content = editor.getText().trim()
    if (!content) return

    setIsSending(true)
    setError(null)

    try {
      const mentions = extractMentions(editor.getJSON() as Record<string, unknown>)
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
      setError(err instanceof Error ? err.message : "Failed to send message")
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
    <div className="shrink-0 border-t bg-background p-4">
      <div className="rounded-lg border bg-background">
        <EditorContent editor={editor} className="max-h-[200px] overflow-y-auto" />

        {editor && (
          <div className="flex items-center justify-between border-t p-2">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => editor.chain().focus().toggleBold().run()}
                disabled={!editor.can().chain().focus().toggleBold().run()}
              >
                <Bold className={cn(
                  "h-3.5 w-3.5",
                  editor.isActive("bold") && "text-primary"
                )} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => editor.chain().focus().toggleItalic().run()}
                disabled={!editor.can().chain().focus().toggleItalic().run()}
              >
                <Italic className={cn(
                  "h-3.5 w-3.5",
                  editor.isActive("italic") && "text-primary"
                )} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => editor.chain().focus().toggleCode().run()}
                disabled={!editor.can().chain().focus().toggleCode().run()}
              >
                <Code className={cn(
                  "h-3.5 w-3.5",
                  editor.isActive("code") && "text-primary"
                )} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              >
                <List className={cn(
                  "h-3.5 w-3.5",
                  editor.isActive("bulletList") && "text-primary"
                )} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              >
                <ListOrdered className={cn(
                  "h-3.5 w-3.5",
                  editor.isActive("orderedList") && "text-primary"
                )} />
              </Button>

              <Separator orientation="vertical" className="mx-1 h-6" />

              <Button variant="ghost" size="icon" className="h-7 w-7" disabled>
                <Paperclip className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Smile className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Button
              size="sm"
              onClick={handleSend}
              disabled={isSending || !editor.getText().trim()}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              Send
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">Enter</kbd> to send,{" "}
        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">Shift+Enter</kbd> for new line
      </p>
    </div>
  )
}
