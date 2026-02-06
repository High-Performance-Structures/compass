"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import {
  SendHorizonal,
  CopyIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  RefreshCcwIcon,
  Check,
  MicIcon,
  XIcon,
  Loader2Icon,
  SquarePenIcon,
} from "lucide-react"
import {
  IconBrandGithub,
  IconExternalLink,
  IconGitFork,
  IconStar,
  IconAlertCircle,
  IconEye,
} from "@tabler/icons-react"
import type { ToolUIPart } from "ai"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai/message"
import { Actions, Action } from "@/components/ai/actions"
import {
  Suggestions,
  Suggestion,
} from "@/components/ai/suggestion"
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai/tool"
import { Loader } from "@/components/ai/loader"
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  PromptInputButton,
} from "@/components/ai/prompt-input"
import { useAudioRecorder } from "@/hooks/use-audio-recorder"
import type { AudioRecorder } from "@/hooks/use-audio-recorder"
import { AudioWaveform } from "@/components/ai/audio-waveform"
import { useChatState } from "./chat-provider"
import { getRepoStats } from "@/app/actions/github"

type RepoStats = {
  readonly stargazers_count: number
  readonly forks_count: number
  readonly open_issues_count: number
  readonly subscribers_count: number
}

interface ChatViewProps {
  readonly variant: "page" | "panel"
}

const REPO = "High-Performance-Structures/compass"
const GITHUB_URL = `https://github.com/${REPO}`

const ANIMATED_PLACEHOLDERS = [
  "Show me open invoices",
  "What's on the schedule for next week?",
  "Which subcontractors are waiting on payment?",
  "Pull up the current project timeline",
  "Find outstanding invoices over 30 days",
  "Who's assigned to the foundation work?",
]

const DASHBOARD_SUGGESTIONS = [
  "What can you help me with?",
  "Show me today's tasks",
  "Navigate to customers",
]

const LOGO_MASK = {
  maskImage: "url(/logo-black.png)",
  maskSize: "contain",
  maskRepeat: "no-repeat",
  WebkitMaskImage: "url(/logo-black.png)",
  WebkitMaskSize: "contain",
  WebkitMaskRepeat: "no-repeat",
} as React.CSSProperties

function getSuggestionsForPath(pathname: string): string[] {
  if (pathname.includes("/customers")) {
    return [
      "Show me all customers",
      "Create a new customer",
      "Find customers without email",
    ]
  }
  if (pathname.includes("/vendors")) {
    return [
      "List all vendors",
      "Add a new subcontractor",
      "Show vendors by category",
    ]
  }
  if (pathname.includes("/schedule")) {
    return [
      "What tasks are on the critical path?",
      "Show overdue tasks",
      "Add a new task",
    ]
  }
  if (pathname.includes("/finances")) {
    return [
      "Show overdue invoices",
      "What payments are pending?",
      "Create a new invoice",
    ]
  }
  if (pathname.includes("/projects")) {
    return [
      "List all active projects",
      "Create a new project",
      "Which projects are behind schedule?",
    ]
  }
  if (pathname.includes("/netsuite")) {
    return [
      "Sync customers from NetSuite",
      "Check for sync conflicts",
      "When was the last sync?",
    ]
  }

  return DASHBOARD_SUGGESTIONS
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  queryData: "Looking up records",
  queryGitHub: "Checking development status",
  createGitHubIssue: "Creating GitHub issue",
  saveInterviewFeedback: "Saving your feedback",
  navigateTo: "Navigating",
  showNotification: "Sending notification",
  generateUI: "Building interface",
}

function friendlyToolName(raw: string): string {
  return TOOL_DISPLAY_NAMES[raw] ?? raw
}

// shared message + tool rendering for both variants
function ChatMessage({
  msg,
  copiedId,
  onCopy,
  onRegenerate,
}: {
  readonly msg: {
    readonly id: string
    readonly role: string
    readonly parts: ReadonlyArray<unknown>
  }
  readonly copiedId: string | null
  onCopy: (id: string, text: string) => void
  onRegenerate: () => void
}) {
  if (msg.role === "user") {
    const text = getTextContent(msg.parts)
    return (
      <Message from="user">
        <MessageContent>{text}</MessageContent>
      </Message>
    )
  }

  const textParts: string[] = []
  const toolParts: Array<{
    type: string
    state: ToolUIPart["state"]
    toolName: string
    input: unknown
    output: unknown
    errorText?: string
  }> = []

  for (const part of msg.parts) {
    const p = part as Record<string, unknown>
    if (p.type === "text" && typeof p.text === "string") {
      textParts.push(p.text)
    }
    const pType = p.type as string | undefined
    // handle static (tool-<name>) and dynamic
    // (dynamic-tool) tool parts
    if (
      typeof pType === "string" &&
      (pType.startsWith("tool-") ||
        pType === "dynamic-tool")
    ) {
      // extract tool name from type field or toolName
      const rawName = pType.startsWith("tool-")
        ? pType.slice(5)
        : ((p.toolName ?? "") as string)
      toolParts.push({
        type: pType,
        state: p.state as ToolUIPart["state"],
        toolName:
          friendlyToolName(rawName) || "Working",
        input: p.input,
        output: p.output,
        errorText: p.errorText as string | undefined,
      })
    }
  }

  const text = textParts.join("")

  return (
    <Message from="assistant">
      {toolParts.map((tp, i) => (
        <Tool key={i}>
          <ToolHeader
            title={tp.toolName}
            type={tp.type as ToolUIPart["type"]}
            state={tp.state}
          />
          <ToolContent>
            <ToolInput input={tp.input} />
            {(tp.state === "output-available" ||
              tp.state === "output-error") && (
              <ToolOutput
                output={tp.output}
                errorText={tp.errorText}
              />
            )}
          </ToolContent>
        </Tool>
      ))}
      {text ? (
        <>
          <MessageContent>
            <MessageResponse>{text}</MessageResponse>
          </MessageContent>
          <Actions>
            <Action
              tooltip="Copy"
              onClick={() => onCopy(msg.id, text)}
            >
              {copiedId === msg.id ? (
                <Check className="size-4" />
              ) : (
                <CopyIcon className="size-4" />
              )}
            </Action>
            <Action tooltip="Good response">
              <ThumbsUpIcon className="size-4" />
            </Action>
            <Action tooltip="Bad response">
              <ThumbsDownIcon className="size-4" />
            </Action>
            <Action
              tooltip="Regenerate"
              onClick={onRegenerate}
            >
              <RefreshCcwIcon className="size-4" />
            </Action>
          </Actions>
        </>
      ) : (
        <Loader />
      )}
    </Message>
  )
}

function getTextContent(
  parts: ReadonlyArray<unknown>
): string {
  return (parts as ReadonlyArray<{ type: string; text?: string }>)
    .filter(
      (p): p is { type: "text"; text: string } =>
        p.type === "text"
    )
    .map((p) => p.text)
    .join("")
}

function ChatInput({
  textareaRef,
  placeholder,
  recorder,
  status,
  isGenerating,
  onSend,
  onNewChat,
  className,
}: {
  readonly textareaRef: React.RefObject<
    HTMLTextAreaElement | null
  >
  readonly placeholder: string
  readonly recorder: AudioRecorder
  readonly status: string
  readonly isGenerating: boolean
  readonly onSend: (text: string) => void
  readonly onNewChat?: () => void
  readonly className?: string
}) {
  const isRecording = recorder.state === "recording"
  const isTranscribing = recorder.state === "transcribing"
  const isIdle = recorder.state === "idle"

  return (
    <PromptInput
      className={className}
      onSubmit={({ text }) => {
        if (!text.trim() || isGenerating) return
        onSend(text.trim())
      }}
    >
      {/* textarea stays mounted (hidden) to preserve value */}
      <PromptInputTextarea
        ref={textareaRef}
        placeholder={placeholder}
        className={isIdle ? undefined : "hidden"}
      />

      {/* recording: waveform + cancel/confirm on one row */}
      {isRecording && recorder.stream && (
        <div className="flex items-center gap-2 px-2 py-3">
          <AudioWaveform
            stream={recorder.stream}
            className="flex-1 h-8"
          />
          <PromptInputButton
            onClick={recorder.cancel}
          >
            <XIcon className="size-4" />
          </PromptInputButton>
          <PromptInputButton
            onClick={recorder.stop}
          >
            <Check className="size-4" />
          </PromptInputButton>
        </div>
      )}

      {/* transcribing */}
      {isTranscribing && (
        <div className="flex items-center justify-center gap-2 px-3 py-3 min-h-10 text-muted-foreground text-sm">
          <Loader2Icon className="size-4 animate-spin" />
          <span>Transcribing...</span>
        </div>
      )}

      {/* footer: mic + submit (hidden during recording/transcribing) */}
      {!isRecording && !isTranscribing && (
        <PromptInputFooter>
          <PromptInputTools>
            {onNewChat && (
              <PromptInputButton onClick={onNewChat} aria-label="New chat">
                <SquarePenIcon className="size-4" />
              </PromptInputButton>
            )}
          </PromptInputTools>
          <div className="flex items-center gap-1">
            <PromptInputButton
              disabled={
                !recorder.supported || !isIdle
              }
              onClick={() => {
                recorder.start()
              }}
            >
              <MicIcon className="size-4" />
            </PromptInputButton>
            <PromptInputSubmit
              status={
                status as
                  | "streaming"
                  | "submitted"
                  | "ready"
                  | "error"
              }
            />
          </div>
        </PromptInputFooter>
      )}
    </PromptInput>
  )
}

export function ChatView({ variant }: ChatViewProps) {
  const chat = useChatState()
  const isPage = variant === "page"
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // fetch repo stats client-side (page variant only)
  const [stats, setStats] = useState<RepoStats | null>(null)
  const statsFetched = useRef(false)
  useEffect(() => {
    if (!isPage || statsFetched.current) return
    statsFetched.current = true
    getRepoStats().then(setStats)
  }, [isPage])

  const handleTranscription = useCallback(
    (text: string) => {
      const ta = textareaRef.current
      if (!ta) return
      const cur = ta.value
      ta.value = cur + (cur ? " " : "") + text
      ta.dispatchEvent(
        new Event("input", { bubbles: true })
      )
    },
    []
  )

  const recorder = useAudioRecorder(handleTranscription)

  const [isActive, setIsActive] = useState(false)
  const [idleInput, setIdleInput] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(
    null
  )

  // typewriter animation state (page variant only)
  const [animatedPlaceholder, setAnimatedPlaceholder] =
    useState("")
  const [animFading, setAnimFading] = useState(false)
  const [isIdleFocused, setIsIdleFocused] = useState(false)
  const animTimerRef =
    useRef<ReturnType<typeof setTimeout>>(undefined)

  // if returning to page variant with existing messages,
  // jump straight to active
  useEffect(() => {
    if (isPage && chat.messages.length > 0 && !isActive) {
      setIsActive(true)
    }
  }, [isPage, chat.messages.length, isActive])

  // typewriter animation for idle input (page variant)
  useEffect(() => {
    if (
      !isPage ||
      isIdleFocused ||
      idleInput ||
      isActive
    ) {
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
  }, [isPage, isIdleFocused, idleInput, isActive])

  // escape to return to idle when no messages (page)
  useEffect(() => {
    if (!isPage) return
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        isActive &&
        chat.messages.length === 0
      ) {
        setIsActive(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () =>
      window.removeEventListener("keydown", onKey)
  }, [isPage, isActive, chat.messages.length])

  const handleCopy = useCallback(
    (id: string, content: string) => {
      navigator.clipboard.writeText(content)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    },
    []
  )

  const handleIdleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const value = idleInput.trim()
      setIsActive(true)
      if (value) {
        chat.sendMessage({ text: value })
        setIdleInput("")
      }
    },
    [idleInput, chat.sendMessage]
  )

  const handleSuggestion = useCallback(
    (text: string) => {
      if (isPage) setIsActive(true)
      chat.sendMessage({ text })
    },
    [isPage, chat.sendMessage]
  )

  const suggestions = isPage
    ? DASHBOARD_SUGGESTIONS
    : getSuggestionsForPath(chat.pathname)

  // --- PAGE variant ---
  if (isPage) {
    return (
      <div className="flex flex-1 flex-col min-h-0">
        {/* Compact header - active only */}
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
          {/* Idle hero */}
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
                  <span className="text-xs">{REPO}</span>
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

          {/* Active conversation */}
          <div
            className={cn(
              "absolute inset-0 flex flex-col",
              "transition-all duration-500 ease-in-out delay-100",
              isActive
                ? "opacity-100 translate-y-0"
                : "opacity-0 -translate-y-4 pointer-events-none"
            )}
          >
            {chat.messages.length > 0 ? (
              <Conversation className="flex-1">
                <ConversationContent className="mx-auto w-full max-w-3xl">
                  {chat.messages.map((msg) => (
                    <ChatMessage
                      key={msg.id}
                      msg={msg}
                      copiedId={copiedId}
                      onCopy={handleCopy}
                      onRegenerate={chat.regenerate}
                    />
                  ))}
                </ConversationContent>
                <ConversationScrollButton />
              </Conversation>
            ) : (
              <div className="flex-1 flex items-end">
                <div className="mx-auto w-full max-w-2xl pb-4">
                  <Suggestions className="justify-center px-4">
                    {suggestions.map((s) => (
                      <Suggestion
                        key={s}
                        suggestion={s}
                        onClick={handleSuggestion}
                      />
                    ))}
                  </Suggestions>
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
          <div className="mx-auto max-w-3xl">
            <ChatInput
              textareaRef={textareaRef}
              placeholder="Ask follow-up..."
              recorder={recorder}
              status={chat.status}
              isGenerating={chat.isGenerating}
              onSend={(text) =>
                chat.sendMessage({ text })
              }
              onNewChat={chat.messages.length > 0 ? chat.newChat : undefined}
              className="rounded-2xl"
            />
          </div>
        </div>
      </div>
    )
  }

  // --- PANEL variant ---
  return (
    <div className="flex h-full w-full flex-col">
      {/* Conversation */}
      <Conversation className="flex-1">
        <ConversationContent>
          {chat.messages.length === 0 ? (
            <div className="flex flex-col items-center gap-4 pt-8">
              <Suggestions>
                {suggestions.map((s) => (
                  <Suggestion
                    key={s}
                    suggestion={s}
                    onClick={handleSuggestion}
                  />
                ))}
              </Suggestions>
            </div>
          ) : (
            chat.messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                msg={msg}
                copiedId={copiedId}
                onCopy={handleCopy}
                onRegenerate={chat.regenerate}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Input */}
      <div className="p-3">
            <ChatInput
              textareaRef={textareaRef}
              placeholder="Ask anything..."
              recorder={recorder}
              status={chat.status}
              isGenerating={chat.isGenerating}
              onSend={(text) =>
                chat.sendMessage({ text })
              }
              onNewChat={chat.messages.length > 0 ? chat.newChat : undefined}
            />
      </div>
    </div>
  )
}
