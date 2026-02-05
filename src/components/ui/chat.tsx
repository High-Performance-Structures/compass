"use client"

import {
    forwardRef,
    useCallback,
    useRef,
    type PropsWithChildren,
} from "react"
import { ArrowDown, PaperclipIcon, SquareIcon, ThumbsDown, ThumbsUp } from "lucide-react"

import { cn } from "@/lib/utils"
import { useAutoScroll } from "@/hooks/use-auto-scroll"
import { Button } from "@/components/ui/button"
import { type Message } from "@/components/ui/chat-message"
import { CopyButton } from "@/components/ui/copy-button"
import { MessageList } from "@/components/ui/message-list"
import { PromptSuggestions } from "@/components/ui/prompt-suggestions"
import {
    PromptInput,
    PromptInputAttachment,
    PromptInputAttachments,
    PromptInputBody,
    PromptInputTextarea,
    PromptInputFooter,
    PromptInputTools,
    PromptInputButton,
    PromptInputSubmit,
    PromptInputActionMenu,
    PromptInputActionMenuTrigger,
    PromptInputActionMenuContent,
    PromptInputActionAddAttachments,
} from "@/components/ai/prompt-input"

interface ChatPropsBase {
    messages: Array<Message>
    className?: string
    isGenerating: boolean
    stop?: () => void
    onRateResponse?: (
        messageId: string,
        rating: "thumbs-up" | "thumbs-down"
    ) => void
    setMessages?: (messages: Message[]) => void
    append: (message: { role: "user"; content: string }) => void
}

interface ChatPropsWithoutSuggestions extends ChatPropsBase {
    suggestions?: never
}

interface ChatPropsWithSuggestions extends ChatPropsBase {
    suggestions: string[]
}

type ChatProps = ChatPropsWithoutSuggestions | ChatPropsWithSuggestions

export function Chat({
    messages,
    stop,
    isGenerating,
    append,
    suggestions,
    className,
    onRateResponse,
    setMessages,
}: ChatProps) {
    const isEmpty = messages.length === 0
    const isTyping = messages.at(-1)?.role === "user"

    const messagesRef = useRef(messages)
    messagesRef.current = messages

    const handleStop = useCallback(() => {
        stop?.()

        if (!setMessages) return

        const latestMessages = [...messagesRef.current]
        const lastAssistantMessage = latestMessages.findLast(
            (m) => m.role === "assistant"
        )

        if (!lastAssistantMessage) return

        let needsUpdate = false
        let updatedMessage = { ...lastAssistantMessage }

        if (lastAssistantMessage.toolInvocations) {
            const updatedToolInvocations = lastAssistantMessage.toolInvocations.map(
                (toolInvocation) => {
                    if (toolInvocation.state === "call") {
                        needsUpdate = true
                        return {
                            ...toolInvocation,
                            state: "result",
                            result: {
                                content: "Tool execution was cancelled",
                                __cancelled: true,
                            },
                        } as const
                    }
                    return toolInvocation
                }
            )

            if (needsUpdate) {
                updatedMessage = {
                    ...updatedMessage,
                    toolInvocations: updatedToolInvocations,
                }
            }
        }

        if (lastAssistantMessage.parts && lastAssistantMessage.parts.length > 0) {
            const updatedParts = lastAssistantMessage.parts.map((part) => {
                const p = part as { type: string; toolInvocation?: { state: string } }
                if (
                    p.type === "tool-invocation" &&
                    p.toolInvocation &&
                    p.toolInvocation.state === "call"
                ) {
                    needsUpdate = true
                    return {
                        ...part,
                        toolInvocation: {
                            ...p.toolInvocation,
                            state: "result" as const,
                            result: {
                                content: "Tool execution was cancelled",
                                __cancelled: true,
                            },
                        },
                    }
                }
                return part
            })

            if (needsUpdate) {
                updatedMessage = {
                    ...updatedMessage,
                    parts: updatedParts as Message["parts"],
                }
            }
        }

        if (needsUpdate) {
            const messageIndex = latestMessages.findIndex(
                (m) => m.id === lastAssistantMessage.id
            )
            if (messageIndex !== -1) {
                latestMessages[messageIndex] = updatedMessage
                setMessages(latestMessages)
            }
        }
    }, [stop, setMessages, messagesRef])

    const messageOptions = useCallback(
        (message: Message) => ({
            actions: onRateResponse ? (
                <>
                    <div className="border-r pr-1">
                        <CopyButton
                            content={message.content}
                            copyMessage="Copied response to clipboard!"
                        />
                    </div>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => onRateResponse(message.id, "thumbs-up")}
                    >
                        <ThumbsUp className="h-4 w-4" />
                    </Button>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => onRateResponse(message.id, "thumbs-down")}
                    >
                        <ThumbsDown className="h-4 w-4" />
                    </Button>
                </>
            ) : (
                <CopyButton
                    content={message.content}
                    copyMessage="Copied response to clipboard!"
                />
            ),
        }),
        [onRateResponse]
    )

    return (
        <ChatContainer className={className}>
            {isEmpty && suggestions?.length ? (
                <PromptSuggestions
                    label="Try these prompts"
                    append={append}
                    suggestions={suggestions}
                />
            ) : null}

            {messages.length > 0 ? (
                <ChatMessages messages={messages}>
                    <MessageList
                        messages={messages}
                        isTyping={isTyping}
                        messageOptions={messageOptions}
                    />
                </ChatMessages>
            ) : null}

            <div className="mt-auto px-4 py-3">
                <PromptInput
                    multiple
                    onSubmit={({ text }) => {
                        if (text.trim()) {
                            append({ role: "user", content: text })
                        }
                    }}
                >
                    <PromptInputAttachments>
                        {(attachment) => <PromptInputAttachment data={attachment} />}
                    </PromptInputAttachments>
                    <PromptInputBody>
                        <PromptInputTextarea placeholder="Ask Compass..." />
                    </PromptInputBody>
                    <PromptInputFooter>
                        <PromptInputTools>
                            <PromptInputActionMenu>
                                <PromptInputActionMenuTrigger>
                                    <PaperclipIcon className="size-4" />
                                </PromptInputActionMenuTrigger>
                                <PromptInputActionMenuContent>
                                    <PromptInputActionAddAttachments />
                                </PromptInputActionMenuContent>
                            </PromptInputActionMenu>
                        </PromptInputTools>
                        {isGenerating ? (
                            <PromptInputButton onClick={handleStop}>
                                <SquareIcon className="size-4" />
                            </PromptInputButton>
                        ) : (
                            <PromptInputSubmit />
                        )}
                    </PromptInputFooter>
                </PromptInput>
            </div>
        </ChatContainer>
    )
}
Chat.displayName = "Chat"

export function ChatMessages({
    messages,
    children,
}: PropsWithChildren<{
    messages: Message[]
}>) {
    const {
        containerRef,
        scrollToBottom,
        handleScroll,
        shouldAutoScroll,
        handleTouchStart,
    } = useAutoScroll([messages])

    return (
        <div
            className="grid grid-cols-1 overflow-y-auto pb-4"
            ref={containerRef}
            onScroll={handleScroll}
            onTouchStart={handleTouchStart}
        >
            <div className="max-w-full px-4 pt-4 [grid-column:1/1] [grid-row:1/1]">
                {children}
            </div>

            {!shouldAutoScroll && (
                <div className="pointer-events-none flex flex-1 items-end justify-end [grid-column:1/1] [grid-row:1/1]">
                    <div className="sticky bottom-0 left-0 flex w-full justify-end">
                        <Button
                            onClick={scrollToBottom}
                            className="pointer-events-auto h-8 w-8 rounded-full ease-in-out animate-in fade-in-0 slide-in-from-bottom-1"
                            size="icon"
                            variant="ghost"
                        >
                            <ArrowDown className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

export const ChatContainer = forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
    return (
        <div
            ref={ref}
            className={cn("grid max-h-full w-full grid-rows-[1fr_auto]", className)}
            {...props}
        />
    )
})
ChatContainer.displayName = "ChatContainer"
