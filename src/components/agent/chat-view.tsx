"use client"

import { useState, useCallback, useRef, useEffect, memo } from "react"
import {
  CopyIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  RefreshCcwIcon,
  Check,
  MicIcon,
  XIcon,
  Loader2Icon,
  SquarePenIcon,
  ImagePlusIcon,
} from "lucide-react"
import {
  IconBrandGithub,
  IconExternalLink,
  IconGitFork,
  IconStar,
  IconAlertCircle,
  IconEye,
} from "@tabler/icons-react"
import type { AgentMessage } from "@/lib/agent/message-types"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { cn } from "@/lib/utils"
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai/reasoning"
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
  PromptInputAttachment,
  PromptInputAttachments,
  usePromptInputAttachments,
} from "@/components/ai/prompt-input"
import { useAudioRecorder } from "@/hooks/use-audio-recorder"
import type { AudioRecorder } from "@/hooks/use-audio-recorder"
import { AudioWaveform } from "@/components/ai/audio-waveform"
import { useChatState } from "./chat-provider"
import { getRepoStats } from "@/app/actions/github"
import {
  MAX_JARVIS_VISUALS,
  prepareJarvisVisuals,
  type JarvisVisualAttachment,
} from "@/lib/agent/visual-context"

type RepoStats = {
  readonly stargazers_count: number
  readonly forks_count: number
  readonly open_issues_count: number
  readonly subscribers_count: number
}

interface ChatViewProps {
  readonly variant: "page" | "panel"
  readonly minimal?: boolean
  readonly hideSuggestions?: boolean
  onActivate?: () => void
  readonly inputPlaceholder?: string
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

function getSuggestionsForPath(
  pathname: string,
  developerModeEnabled: boolean
): string[] {
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
  if (developerModeEnabled && pathname.includes("/netsuite")) {
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

interface ChatMessageProps {
  readonly msg: AgentMessage
  readonly copiedId: string | null
  readonly onCopy: (id: string, text: string) => void
  readonly onRegenerate: () => void
  readonly isStreaming?: boolean
}

// renders parts in their natural order from the AI SDK
const ChatMessage = memo(
  function ChatMessage({
    msg,
    copiedId,
    onCopy,
    onRegenerate,
  }: ChatMessageProps) {
    const { developerModeEnabled } = useDeveloperMode()
    if (msg.role === "user") {
      const text = msg.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as Extract<typeof p, { type: "text" }>).text)
        .join("")
      const images = msg.parts.filter(
        (part): part is Extract<typeof part, { type: "image" }> =>
          part.type === "image",
      )
      return (
        <Message from="user">
          <MessageContent>
            {images.length > 0 && (
              <div className="mb-2 grid max-w-md grid-cols-2 gap-2">
                {images.map((image, index) =>
                  image.dataUrl ? (
                    <img
                      alt={image.filename}
                      className="max-h-64 w-full rounded-md border object-contain"
                      key={`${image.filename}-${index}`}
                      src={image.dataUrl}
                    />
                  ) : (
                    <div
                      className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
                      key={`${image.filename}-${index}`}
                    >
                      <ImagePlusIcon className="size-4" />
                      <span className="truncate">{image.filename}</span>
                    </div>
                  ),
                )}
              </div>
            )}
            {text}
          </MessageContent>
        </Message>
      )
    }

    // walk parts sequentially, flushing text when
    // hitting a tool or reasoning part to preserve
    // interleaving. text flushed before the final
    // segment is "thinking" (intermediate chain-of-
    // thought) and rendered muted + collapsible.
    const elements: React.ReactNode[] = []
    let pendingText = ""
    let allText = ""
    let pendingReasoning = ""
    let reasoningStreaming = false

    const flushThinking = (
      text: string,
      idx: number,
      streaming = false
    ) => {
      if (!developerModeEnabled || !text) return
      elements.push(
        <Reasoning
          key={`think-${idx}`}
          isStreaming={streaming}
          defaultOpen={false}
        >
          <ReasoningTrigger />
          <ReasoningContent>{text}</ReasoningContent>
        </Reasoning>
      )
    }

    const flushText = (idx: number, isFinal: boolean) => {
      if (!pendingText) return
      if (!isFinal) {
        // intermediate text before more tools = thinking
        flushThinking(pendingText, idx)
      } else {
        elements.push(
          <MessageContent key={`text-${idx}`}>
            <MessageResponse>
              {pendingText}
            </MessageResponse>
          </MessageContent>
        )
      }
      pendingText = ""
    }

    for (let i = 0; i < msg.parts.length; i++) {
      const part = msg.parts[i]

      if (part.type === "reasoning") {
        if (!developerModeEnabled) continue
        pendingReasoning += part.text
        reasoningStreaming = part.state === "streaming"
        continue
      }

      if (part.type === "text") {
        pendingText += part.text
        allText += part.text
        continue
      }

      if (part.type === "tool-call") {
        if (!developerModeEnabled) {
          pendingReasoning = ""
          reasoningStreaming = false
          pendingText = ""
          allText = ""
          continue
        }
        // flush reasoning accumulated before this tool
        flushThinking(pendingReasoning, i, reasoningStreaming)
        pendingReasoning = ""
        reasoningStreaming = false
        // flush text as thinking (not final)
        flushText(i, false)
        const rawName = part.toolName

        // map our state to the expected Tool component state
        const toolState =
          part.state === "partial-call"
            ? "partial-call"
            : part.state === "call"
            ? "call"
            : "result"

        // find matching result for this tool call
        const resultPart = msg.parts.find(
          (p) =>
            p.type === "tool-result" &&
            p.toolCallId === part.toolCallId
        ) as Extract<
          AgentMessage["parts"][number],
          { type: "tool-result" }
        > | undefined

        elements.push(
          <Tool key={`tool-${part.toolCallId}`}>
            <ToolHeader
              title={
                friendlyToolName(rawName) || "Working"
              }
              type={"tool-call" as const}
              state={toolState}
            />
            <ToolContent>
              <ToolInput input={part.args} />
              {resultPart && (
                <ToolOutput
                  output={resultPart.result}
                  errorText={
                    resultPart.isError
                      ? String(resultPart.result)
                      : undefined
                  }
                />
              )}
            </ToolContent>
          </Tool>
        )
      }
    }

    // flush remaining reasoning
    flushThinking(
      pendingReasoning,
      msg.parts.length,
      reasoningStreaming
    )

    // flush remaining text as the final response
    flushText(msg.parts.length, true)

    const hasContent = elements.length > 0

    return (
      <Message from="assistant">
        {hasContent ? elements : <Loader />}
        {allText && (
          <Actions>
            <Action
              tooltip="Copy"
              onClick={() => onCopy(msg.id, allText)}
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
        )}
      </Message>
    )
  },
  (prev, next) => {
    if (prev.msg !== next.msg) return false
    if (prev.onCopy !== next.onCopy) return false
    if (prev.onRegenerate !== next.onRegenerate)
      return false
    if (prev.isStreaming !== next.isStreaming)
      return false
    const prevCopied = prev.copiedId === prev.msg.id
    const nextCopied = next.copiedId === next.msg.id
    if (prevCopied !== nextCopied) return false
    return true
  }
)

function VisualAttachmentButton(): React.ReactNode {
  const attachments = usePromptInputAttachments()
  return (
    <PromptInputButton
      aria-label="Attach screenshots for Jarvis"
      onClick={attachments.openFileDialog}
      type="button"
    >
      <ImagePlusIcon className="size-4" />
    </PromptInputButton>
  )
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
  onActivate,
}: {
  readonly textareaRef: React.RefObject<
    HTMLTextAreaElement | null
  >
  readonly placeholder: string
  readonly recorder: AudioRecorder
  readonly status: string
  readonly isGenerating: boolean
  readonly onSend: (input: {
    readonly text: string
    readonly visuals?: readonly JarvisVisualAttachment[]
  }) => Promise<boolean>
  readonly onNewChat?: () => void
  readonly className?: string
  readonly onActivate?: () => void
}) {
  const isRecording = recorder.state === "recording"
  const isTranscribing = recorder.state === "transcribing"
  const isIdle = recorder.state === "idle"
  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  return (
    <PromptInput
      accept="image/jpeg,image/png,image/webp"
      className={className}
      maxFiles={MAX_JARVIS_VISUALS}
      maxFileSize={10 * 1024 * 1024}
      multiple
      onClickCapture={onActivate}
      onFocusCapture={onActivate}
      onError={({ message }) => setAttachmentError(message)}
      onSubmit={async ({ text, files }) => {
        if ((!text.trim() && files.length === 0) || isGenerating) return
        setAttachmentError(null)
        try {
          const visuals = await prepareJarvisVisuals(files)
          const sent = await onSend({ text: text.trim(), visuals })
          if (!sent) throw new Error("The message was not sent.")
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Jarvis could not prepare that image."
          setAttachmentError(message)
          throw error
        }
      }}
    >
      <PromptInputAttachments>
        {(attachment) => <PromptInputAttachment data={attachment} />}
      </PromptInputAttachments>
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
            <VisualAttachmentButton />
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
      {attachmentError && (
        <p className="px-3 pb-2 text-xs text-destructive" role="alert">
          {attachmentError}
        </p>
      )}
    </PromptInput>
  )
}

export function ChatView({
  variant,
  minimal = false,
  hideSuggestions = false,
  onActivate,
  inputPlaceholder,
}: ChatViewProps) {
  const { developerModeEnabled } = useDeveloperMode()
  const chat = useChatState()
  const isPage = variant === "page"
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // fetch repo stats client-side (page variant only)
  const [stats, setStats] = useState<RepoStats | null>(null)
  const statsFetched = useRef(false)
  useEffect(() => {
    if (!isPage || !developerModeEnabled || statsFetched.current) return
    statsFetched.current = true
    getRepoStats().then(setStats)
  }, [developerModeEnabled, isPage])

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
  const [copiedId, setCopiedId] = useState<string | null>(
    null
  )
  const [dismissedError, setDismissedError] = useState<
    string | null
  >(null)

  // typewriter animation state (page variant only)
  const [animatedPlaceholder, setAnimatedPlaceholder] =
    useState("")
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
    if (!isPage || isActive) {
      setAnimatedPlaceholder("")
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
        animTimerRef.current = setTimeout(tick, 400)
      } else {
        msgIdx =
          (msgIdx + 1) % ANIMATED_PLACEHOLDERS.length
        charIdx = 1
        setAnimatedPlaceholder(
          ANIMATED_PLACEHOLDERS[msgIdx].slice(0, 1)
        )
        phase = "typing"
        animTimerRef.current = setTimeout(tick, 50)
      }
    }

    animTimerRef.current = setTimeout(tick, 600)

    return () => {
      if (animTimerRef.current)
        clearTimeout(animTimerRef.current)
    }
  }, [isPage, isActive])

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

  const handleSuggestion = useCallback(
    (text: string) => {
      if (isPage) setIsActive(true)
      chat.sendMessage({ text })
    },
    [isPage, chat.sendMessage]
  )

  const handleIdleSend = useCallback(
    async (input: {
      readonly text: string
      readonly visuals?: readonly JarvisVisualAttachment[]
    }): Promise<boolean> => {
      setIsActive(true)
      return chat.sendMessage(input)
    },
    [chat.sendMessage]
  )

  const handleActiveSend = useCallback(
    (input: {
      readonly text: string
      readonly visuals?: readonly JarvisVisualAttachment[]
    }): Promise<boolean> => chat.sendMessage(input),
    [chat.sendMessage]
  )

  const suggestions = isPage
    ? DASHBOARD_SUGGESTIONS
    : getSuggestionsForPath(chat.pathname, developerModeEnabled)

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
            className="mx-auto mb-2 block bg-foreground size-10"
            style={LOGO_MASK}
          />
          <h1 className="text-base sm:text-lg font-bold tracking-tight">
            Jarvis
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
            <div className="w-full max-w-2xl px-5 space-y-4 text-center">
              <div className="-mt-16">
                <span
                  className="mx-auto mb-4 block bg-foreground size-20"
                  style={LOGO_MASK}
                />
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  Jarvis
                </h1>
                <p className="text-muted-foreground/60 mt-1.5 text-xs px-2">
                  Your Compass project assistant
                </p>
              </div>
              <ChatInput
                textareaRef={textareaRef}
                placeholder={
                  animatedPlaceholder || "Ask Jarvis..."
                }
                recorder={recorder}
                status={chat.status}
                isGenerating={chat.isGenerating}
                onSend={handleIdleSend}
                className="mt-[6rem] rounded-lg"
              />

              {developerModeEnabled && stats && (
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
                  {chat.messages.map((msg, idx) => (
                    <ChatMessage
                      key={msg.id}
                      msg={msg}
                      copiedId={copiedId}
                      onCopy={handleCopy}
                      onRegenerate={chat.regenerate}
                      isStreaming={
                        (chat.status === "streaming" ||
                          chat.status === "submitted") &&
                        idx === chat.messages.length - 1 &&
                        msg.role === "assistant"
                      }
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
            {/* Error banner - page variant */}
            {chat.error && chat.error !== dismissedError && (
              <div className="mx-auto w-full max-w-3xl px-4 pb-2">
                <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  <IconAlertCircle className="size-4 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">Request failed</p>
                    <p className="text-destructive/80 truncate">
                      {chat.error}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDismissedError(chat.error)}
                    className="shrink-0 rounded-md p-1 hover:bg-destructive/20 transition-colors"
                    aria-label="Dismiss error"
                  >
                    <XIcon className="size-4" />
                  </button>
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
              placeholder="Ask Jarvis a follow-up..."
              recorder={recorder}
              status={chat.status}
              isGenerating={chat.isGenerating}
              onSend={handleActiveSend}
              onNewChat={chat.messages.length > 0 ? chat.newChat : undefined}
              className="rounded-lg"
            />
          </div>
        </div>
      </div>
    )
  }

  // --- PANEL variant ---
  if (minimal) {
    return (
      <div className="w-full p-2">
        <ChatInput
          textareaRef={textareaRef}
          placeholder={inputPlaceholder ?? "Create a new setting"}
          recorder={recorder}
          status={chat.status}
          isGenerating={chat.isGenerating}
          onSend={handleActiveSend}
          onActivate={onActivate}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* Conversation */}
      <Conversation className="flex-1">
        <ConversationContent>
          {chat.messages.length === 0 ? (
            <div
              className={cn(
                "flex flex-col items-center gap-4",
                hideSuggestions ? "h-full" : "pt-8"
              )}
            >
              {!hideSuggestions && (
                <Suggestions>
                  {suggestions.map((s) => (
                    <Suggestion
                      key={s}
                      suggestion={s}
                      onClick={handleSuggestion}
                    />
                  ))}
                </Suggestions>
              )}
            </div>
          ) : (
            chat.messages.map((msg, idx) => (
              <ChatMessage
                key={msg.id}
                msg={msg}
                copiedId={copiedId}
                onCopy={handleCopy}
                onRegenerate={chat.regenerate}
                isStreaming={
                  (chat.status === "streaming" ||
                    chat.status === "submitted") &&
                  idx === chat.messages.length - 1 &&
                  msg.role === "assistant"
                }
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Error banner - panel variant */}
      {chat.error && chat.error !== dismissedError && (
        <div className="px-3 pb-2">
          <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <IconAlertCircle className="size-4 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium">Request failed</p>
              <p className="text-destructive/80 truncate">
                {chat.error}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDismissedError(chat.error)}
              className="shrink-0 rounded-md p-1 hover:bg-destructive/20 transition-colors"
              aria-label="Dismiss error"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-3">
            <ChatInput
              textareaRef={textareaRef}
              placeholder={inputPlaceholder ?? "Ask Jarvis..."}
              recorder={recorder}
              status={chat.status}
              isGenerating={chat.isGenerating}
              onSend={handleActiveSend}
              onNewChat={chat.messages.length > 0 ? chat.newChat : undefined}
            />
      </div>
    </div>
  )
}
