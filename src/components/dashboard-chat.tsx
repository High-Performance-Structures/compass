"use client"

import {
    useState,
    useCallback,
    useRef,
    useEffect,
} from "react"
import { usePathname, useRouter } from "next/navigation"
import {
    ArrowUp,
    Plus,
    SendHorizonal,
    Square,
    Copy,
    ThumbsUp,
    ThumbsDown,
    RefreshCw,
    Check,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { TypingIndicator } from "@/components/ui/typing-indicator"
import { PromptSuggestions } from "@/components/ui/prompt-suggestions"
import {
    useAutosizeTextArea,
} from "@/hooks/use-autosize-textarea"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import {
    dispatchToolActions,
    initializeActionHandlers,
    unregisterActionHandler,
    ALL_HANDLER_TYPES,
} from "@/lib/agent/chat-adapter"
import {
    IconBrandGithub,
    IconExternalLink,
    IconGitFork,
    IconStar,
    IconAlertCircle,
    IconEye,
} from "@tabler/icons-react"

type RepoStats = {
    readonly stargazers_count: number
    readonly forks_count: number
    readonly open_issues_count: number
    readonly subscribers_count: number
}

const REPO = "High-Performance-Structures/compass"
const GITHUB_URL = `https://github.com/${REPO}`

interface DashboardChatProps {
    readonly stats: RepoStats | null
}

const SUGGESTIONS = [
    "What can you help me with?",
    "Show me today's tasks",
    "Navigate to customers",
]

const ANIMATED_PLACEHOLDERS = [
    "Show me open invoices",
    "What's on the schedule for next week?",
    "Which subcontractors are waiting on payment?",
    "Pull up the current project timeline",
    "Find outstanding invoices over 30 days",
    "Who's assigned to the foundation work?",
]

const LOGO_MASK = {
  maskImage: "url(/logo-black.png)",
  maskSize: "contain",
  maskRepeat: "no-repeat",
  WebkitMaskImage: "url(/logo-black.png)",
  WebkitMaskSize: "contain",
  WebkitMaskRepeat: "no-repeat",
} as React.CSSProperties

function getTextFromParts(
  parts: ReadonlyArray<{ type: string; text?: string }>
): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        p.type === "text"
    )
    .map((p) => p.text)
    .join("")
}

export function DashboardChat({ stats }: DashboardChatProps) {
  const [isActive, setIsActive] = useState(false)
  const [idleInput, setIdleInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const pathname = usePathname()
  const [chatInput, setChatInput] = useState("")
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null)

  useAutosizeTextArea({
    ref: chatTextareaRef,
    maxHeight: 200,
    borderWidth: 0,
    dependencies: [chatInput],
  })

  const {
    messages,
    sendMessage,
    regenerate,
    stop,
    status,
  } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/agent",
      headers: { "x-current-page": pathname },
    }),
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const isGenerating =
    status === "streaming" || status === "submitted"

  // initialize action handlers for navigation, toasts, etc
  useEffect(() => {
    initializeActionHandlers(() => routerRef.current)

    const handleToast = (event: CustomEvent) => {
      const { message, type = "default" } =
        event.detail ?? {}
      if (message) {
        if (type === "success") toast.success(message)
        else if (type === "error") toast.error(message)
        else toast(message)
      }
    }

    window.addEventListener(
      "agent-toast",
      handleToast as EventListener
    )

    return () => {
      window.removeEventListener(
        "agent-toast",
        handleToast as EventListener
      )
      for (const type of ALL_HANDLER_TYPES) {
        unregisterActionHandler(type)
      }
    }
  }, [])

  // dispatch tool actions when messages update
  useEffect(() => {
    const last = messages.at(-1)
    if (last?.role !== "assistant") return

    const parts = last.parts as ReadonlyArray<{
      type: string
      toolInvocation?: {
        toolName: string
        state: string
        result?: unknown
      }
    }>

    dispatchToolActions(parts)
  }, [messages])

  const [copiedId, setCopiedId] = useState<string | null>(
    null
  )
  const [animatedPlaceholder, setAnimatedPlaceholder] =
    useState("")
  const [animFading, setAnimFading] = useState(false)
  const [isIdleFocused, setIsIdleFocused] = useState(false)
  const animTimerRef =
    useRef<ReturnType<typeof setTimeout>>(undefined)

  // typewriter animation for idle input placeholder
  useEffect(() => {
    if (isIdleFocused || idleInput || isActive) {
      setAnimatedPlaceholder("")
      setAnimFading(false)
      return
    }

    let msgIdx = 0
    let charIdx = 0
    let phase: "typing" | "pause" | "fading" = "typing"

    const tick = () => {
      const msg = ANIMATED_PLACEHOLDERS[msgIdx]

      if (phase === "typing") {
        charIdx++
        setAnimatedPlaceholder(msg.slice(0, charIdx))
        if (charIdx >= msg.length) {
          phase = "pause"
          animTimerRef.current = setTimeout(tick, 2500)
        } else {
          animTimerRef.current = setTimeout(
            tick,
            25 + Math.random() * 20
          )
        }
      } else if (phase === "pause") {
        phase = "fading"
        setAnimFading(true)
        animTimerRef.current = setTimeout(tick, 400)
      } else {
        msgIdx =
          (msgIdx + 1) % ANIMATED_PLACEHOLDERS.length
        charIdx = 1
        setAnimatedPlaceholder(
          ANIMATED_PLACEHOLDERS[msgIdx].slice(0, 1)
        )
        setAnimFading(false)
        phase = "typing"
        animTimerRef.current = setTimeout(tick, 50)
      }
    }

    animTimerRef.current = setTimeout(tick, 600)

    return () => {
      if (animTimerRef.current)
        clearTimeout(animTimerRef.current)
    }
  }, [isIdleFocused, idleInput, isActive])

  // auto-scroll state
  const autoScrollRef = useRef(true)
  const justSentRef = useRef(false)
  const pinCooldownRef = useRef(false)
  const prevLenRef = useRef(0)

  // called imperatively from send handlers to flag
  // that the next render should do the pin-scroll
  const markSent = useCallback(() => {
    justSentRef.current = true
    autoScrollRef.current = true
  }, [])

  // runs after every render caused by message changes.
  // the DOM is guaranteed to be up-to-date here.
  useEffect(() => {
    if (!isActive) return
    const el = scrollRef.current
    if (!el) return

    // pin-scroll: fires once right after user sends
    if (justSentRef.current) {
      justSentRef.current = false

      const bubbles = el.querySelectorAll(
        "[data-role='user']"
      )
      const last = bubbles[
        bubbles.length - 1
      ] as HTMLElement | undefined

      if (last) {
        const cRect = el.getBoundingClientRect()
        const bRect = last.getBoundingClientRect()
        const topInContainer = bRect.top - cRect.top

        if (topInContainer > cRect.height / 2) {
          const absTop =
            bRect.top - cRect.top + el.scrollTop
          const target = absTop - bRect.height * 0.25

          el.scrollTo({
            top: Math.max(0, target),
            behavior: "smooth",
          })

          // don't let follow-bottom fight the smooth
          // scroll for the next 600ms
          pinCooldownRef.current = true
          setTimeout(() => {
            pinCooldownRef.current = false
          }, 600)
          return
        }
      }
    }

    // follow-bottom: keep the latest content visible
    if (!autoScrollRef.current || pinCooldownRef.current)
      return

    const gap =
      el.scrollHeight - el.scrollTop - el.clientHeight
    if (gap > 0) {
      el.scrollTop = el.scrollHeight - el.clientHeight
    }
  }, [messages, isActive])

  // user scroll detection
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onScroll = () => {
      const gap =
        el.scrollHeight - el.scrollTop - el.clientHeight
      if (gap > 100) autoScrollRef.current = false
      if (gap < 20) autoScrollRef.current = true
    }

    el.addEventListener("scroll", onScroll, {
      passive: true,
    })
    return () =>
      el.removeEventListener("scroll", onScroll)
  }, [isActive, messages.length])
  // Escape to return to idle when no messages
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        isActive &&
        messages.length === 0
      ) {
        setIsActive(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isActive, messages.length])

  useEffect(() => {
    if (!isActive) return
    const timer = setTimeout(() => {
      chatTextareaRef.current?.focus()
    }, 300)
    return () => clearTimeout(timer)
  }, [isActive])

  const handleIdleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const value = idleInput.trim()
      setIsActive(true)
      if (value) {
        sendMessage({ text: value })
        setIdleInput("")
      }
    },
    [idleInput, sendMessage]
  )

  const handleCopy = useCallback(
    (id: string, content: string) => {
      navigator.clipboard.writeText(content)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    },
    []
  )

  const handleSuggestion = useCallback(
    (message: { role: "user"; content: string }) => {
      setIsActive(true)
      sendMessage({ text: message.content })
    },
    [sendMessage]
  )

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Compact hero - active only */}
      <div
        className={cn(
          "shrink-0 text-center transition-all duration-500 ease-in-out overflow-hidden",
          isActive
            ? "py-3 sm:py-4 opacity-100 max-h-40"
            : "py-0 opacity-0 max-h-0"
        )}
      >
        <span
          className="mx-auto mb-2 block bg-foreground size-7"
          style={LOGO_MASK}
        />
        <h1 className="text-base sm:text-lg font-bold tracking-tight">
          Compass
        </h1>
      </div>

      {/* Middle content area */}
      <div className="flex flex-1 flex-col min-h-0 relative">
        {/* Idle: hero + input + stats, all centered */}
        <div
          className={cn(
            "absolute inset-0 flex flex-col items-center justify-center",
            "transition-all duration-500 ease-in-out",
            isActive
              ? "opacity-0 translate-y-4 pointer-events-none"
              : "opacity-100 translate-y-0"
          )}
        >
          <div className="w-full max-w-2xl px-5 space-y-5 text-center">
            <div>
              <span
                className="mx-auto mb-2 block bg-foreground size-10"
                style={LOGO_MASK}
              />
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                Compass
              </h1>
              <p className="text-muted-foreground/60 mt-1.5 text-xs px-2">
                Development preview — features may be
                incomplete or change without notice.
              </p>
            </div>
            <form onSubmit={handleIdleSubmit}>
              <label className="group flex w-full items-center gap-2 rounded-full border bg-background px-5 py-3 text-sm shadow-sm transition-colors hover:border-primary/30 hover:bg-muted/30 cursor-text">
                <input
                  value={idleInput}
                  onChange={(e) =>
                    setIdleInput(e.target.value)
                  }
                  onFocus={() => setIsIdleFocused(true)}
                  onBlur={() => setIsIdleFocused(false)}
                  placeholder={
                    animatedPlaceholder ||
                    "Ask anything..."
                  }
                  className={cn(
                    "flex-1 bg-transparent text-foreground outline-none",
                    "placeholder:text-muted-foreground placeholder:transition-opacity placeholder:duration-300",
                    animFading
                      ? "placeholder:opacity-0"
                      : "placeholder:opacity-100"
                  )}
                />
                <button
                  type="submit"
                  className="shrink-0"
                  aria-label="Send"
                >
                  <SendHorizonal className="size-4 text-muted-foreground/60 transition-colors group-hover:text-primary" />
                </button>
              </label>
            </form>

            {stats && (
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground/70">
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 transition-colors hover:text-foreground"
                >
                  <IconBrandGithub className="size-4" />
                  <span>View on GitHub</span>
                  <IconExternalLink className="size-3" />
                </a>
                <span className="hidden sm:inline text-border">
                  |
                </span>
                <span className="text-xs">
                  {REPO}
                </span>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <IconStar className="size-3.5" />
                    {stats.stargazers_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <IconGitFork className="size-3.5" />
                    {stats.forks_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <IconAlertCircle className="size-3.5" />
                    {stats.open_issues_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <IconEye className="size-3.5" />
                    {stats.subscribers_count}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Active: messages or suggestions */}
        <div
          className={cn(
            "absolute inset-0 flex flex-col",
            "transition-all duration-500 ease-in-out delay-100",
            isActive
              ? "opacity-100 translate-y-0"
              : "opacity-0 -translate-y-4 pointer-events-none"
          )}
        >
          {messages.length > 0 ? (
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto"
            >
              <div className="mx-auto w-full max-w-3xl px-4 py-4 space-y-6">
                {messages.map((msg) => {
                  const textContent = getTextFromParts(
                    msg.parts as ReadonlyArray<{
                      type: string
                      text?: string
                    }>
                  )

                  if (msg.role === "user") {
                    return (
                      <div
                        key={msg.id}
                        data-role="user"
                        className="flex justify-end"
                      >
                        <div className="rounded-2xl border bg-background px-4 py-2.5 text-sm max-w-[80%] shadow-sm">
                          {textContent}
                        </div>
                      </div>
                    )
                  }
                  return (
                    <div
                      key={msg.id}
                      className="flex flex-col items-start"
                    >
                      {textContent ? (
                        <>
                          <div className="w-full text-sm leading-[1.6] prose prose-sm prose-neutral dark:prose-invert max-w-none [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-[15px] [&_p]:my-2.5 [&_ul]:my-2.5 [&_ol]:my-2.5 [&_li]:my-1">
                            <MarkdownRenderer>
                              {textContent}
                            </MarkdownRenderer>
                          </div>
                          <div className="mt-2 flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                handleCopy(
                                  msg.id,
                                  textContent
                                )
                              }
                              className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                              aria-label="Copy"
                            >
                              {copiedId === msg.id ? (
                                <Check className="size-3.5" />
                              ) : (
                                <Copy className="size-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                              aria-label="Good response"
                            >
                              <ThumbsUp className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                              aria-label="Bad response"
                            >
                              <ThumbsDown className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => regenerate()}
                              className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                              aria-label="Regenerate"
                            >
                              <RefreshCw className="size-3.5" />
                            </button>
                          </div>
                        </>
                      ) : (
                        <TypingIndicator />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-end">
              <div className="mx-auto w-full max-w-2xl">
                <PromptSuggestions
                  label="Try these prompts"
                  append={handleSuggestion}
                  suggestions={SUGGESTIONS}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom input - active only */}
      <div
        className={cn(
          "shrink-0 px-4 transition-all duration-500 ease-in-out",
          isActive
            ? "opacity-100 translate-y-0 pt-2 pb-6"
            : "opacity-0 translate-y-4 max-h-0 overflow-hidden pointer-events-none py-0"
        )}
      >
        <form
          className="mx-auto max-w-3xl"
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = chatInput.trim()
            if (!trimmed || isGenerating) return
            sendMessage({ text: trimmed })
            setChatInput("")
            markSent()
          }}
        >
          <div
            className={cn(
              "flex flex-col rounded-2xl border bg-background overflow-hidden",
              "transition-[border-color,box-shadow] duration-200",
              "focus-within:border-ring/40 focus-within:shadow-[0_0_0_3px_rgba(0,0,0,0.04)]",
            )}
          >
            <textarea
              ref={chatTextareaRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  const trimmed = chatInput.trim()
                  if (!trimmed || isGenerating) return
                  sendMessage({
                    text: trimmed,
                  })
                  setChatInput("")
                  markSent()
                }
              }}
              placeholder="Ask follow-up..."
              rows={1}
              className={cn(
                "w-full resize-none bg-transparent text-sm outline-none",
                "overflow-y-auto px-5 pt-4 pb-2",
                "placeholder:text-muted-foreground/60",
              )}
            />
            <div className="flex items-center justify-between px-3 pb-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg",
                    "text-muted-foreground/60 transition-colors",
                    "hover:bg-muted hover:text-foreground",
                  )}
                  aria-label="Add attachment"
                >
                  <Plus className="size-4" />
                </button>
              </div>
              {isGenerating ? (
                <button
                  type="button"
                  onClick={stop}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full",
                    "bg-foreground text-background",
                    "transition-colors hover:bg-foreground/90",
                  )}
                  aria-label="Stop generating"
                >
                  <Square className="size-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!chatInput.trim()}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full",
                    "transition-all duration-200",
                    chatInput.trim()
                      ? "bg-foreground text-background hover:bg-foreground/90"
                      : "bg-muted/60 text-muted-foreground/40",
                  )}
                  aria-label="Send message"
                >
                  <ArrowUp className="size-4" />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
