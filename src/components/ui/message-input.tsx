"use client"

import React, { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowUp, Info, Loader2, Mic, Paperclip, Square } from "lucide-react"
import { omit } from "remeda"

import { cn } from "@/lib/utils"
import { useAudioRecording } from "@/hooks/use-audio-recording"
import { useAutosizeTextArea } from "@/hooks/use-autosize-textarea"
import { AudioVisualizer } from "@/components/ui/audio-visualizer"
import { Button } from "@/components/ui/button"
import { FilePreview } from "@/components/ui/file-preview"
import { InterruptPrompt } from "@/components/ui/interrupt-prompt"

interface MessageInputBaseProps
    extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    value: string
    submitOnEnter?: boolean
    stop?: () => void
    isGenerating: boolean
    enableInterrupt?: boolean
    transcribeAudio?: (blob: Blob) => Promise<string>
}

interface MessageInputWithoutAttachmentProps extends MessageInputBaseProps {
    allowAttachments?: false
}

interface MessageInputWithAttachmentsProps extends MessageInputBaseProps {
    allowAttachments: true
    files: File[] | null
    setFiles: React.Dispatch<React.SetStateAction<File[] | null>>
}

type MessageInputProps =
    | MessageInputWithoutAttachmentProps
    | MessageInputWithAttachmentsProps

export function MessageInput({
    placeholder = "Message Compass...",
    className,
    onKeyDown: onKeyDownProp,
    submitOnEnter = true,
    stop,
    isGenerating,
    enableInterrupt = true,
    transcribeAudio,
    ...props
}: MessageInputProps) {
    const [isDragging, setIsDragging] = useState(false)
    const [showInterruptPrompt, setShowInterruptPrompt] = useState(false)

    const {
        isListening,
        isSpeechSupported,
        isRecording,
        isTranscribing,
        audioStream,
        toggleListening,
        stopRecording,
    } = useAudioRecording({
        transcribeAudio,
        onTranscriptionComplete: (text) => {
            props.onChange?.({ target: { value: text } } as React.ChangeEvent<HTMLTextAreaElement>)
        },
    })

    useEffect(() => {
        if (!isGenerating) {
            setShowInterruptPrompt(false)
        }
    }, [isGenerating])

    const addFiles = (files: File[] | null) => {
        if (props.allowAttachments) {
            props.setFiles((currentFiles) => {
                if (currentFiles === null) return files
                if (files === null) return currentFiles
                return [...currentFiles, ...files]
            })
        }
    }

    const onDragOver = (event: React.DragEvent) => {
        if (props.allowAttachments !== true) return
        event.preventDefault()
        setIsDragging(true)
    }

    const onDragLeave = (event: React.DragEvent) => {
        if (props.allowAttachments !== true) return
        event.preventDefault()
        setIsDragging(false)
    }

    const onDrop = (event: React.DragEvent) => {
        setIsDragging(false)
        if (props.allowAttachments !== true) return
        event.preventDefault()
        const dataTransfer = event.dataTransfer
        if (dataTransfer.files.length) {
            addFiles(Array.from(dataTransfer.files))
        }
    }

    const onPaste = (event: React.ClipboardEvent) => {
        const items = event.clipboardData?.items
        if (!items) return

        const text = event.clipboardData.getData("text")
        if (text && text.length > 500 && props.allowAttachments) {
            event.preventDefault()
            const blob = new Blob([text], { type: "text/plain" })
            const file = new File([blob], "Pasted text", {
                type: "text/plain",
                lastModified: Date.now(),
            })
            addFiles([file])
            return
        }

        const files = Array.from(items)
            .map((item) => item.getAsFile())
            .filter((file) => file !== null)

        if (props.allowAttachments && files.length > 0) {
            addFiles(files)
        }
    }

    const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (submitOnEnter && event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()

            if (isGenerating && stop && enableInterrupt) {
                if (showInterruptPrompt) {
                    stop()
                    setShowInterruptPrompt(false)
                    event.currentTarget.form?.requestSubmit()
                } else if (
                    props.value ||
                    (props.allowAttachments && props.files?.length)
                ) {
                    setShowInterruptPrompt(true)
                    return
                }
            }

            event.currentTarget.form?.requestSubmit()
        }

        onKeyDownProp?.(event)
    }

    const textAreaRef = useRef<HTMLTextAreaElement>(null)

    const showFileList =
        props.allowAttachments && props.files && props.files.length > 0

    useAutosizeTextArea({
        ref: textAreaRef,
        maxHeight: 240,
        borderWidth: 0,
        dependencies: [props.value],
    })

    return (
        <div
            className="relative flex w-full"
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {enableInterrupt && (
                <InterruptPrompt
                    isOpen={showInterruptPrompt}
                    close={() => setShowInterruptPrompt(false)}
                />
            )}

            <RecordingPrompt
                isVisible={isRecording}
                onStopRecording={stopRecording}
            />

            <div
                className={cn(
                    "relative flex w-full flex-col overflow-hidden rounded-md border border-input bg-background shadow-xs",
                    "transition-[color,box-shadow]",
                    "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
                    className
                )}
            >
                <textarea
                    aria-label="Write your prompt here"
                    placeholder={placeholder}
                    ref={textAreaRef}
                    onPaste={onPaste}
                    onKeyDown={onKeyDown}
                    className="w-full grow resize-none bg-transparent px-3 pt-3 pb-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    {...(props.allowAttachments
                        ? omit(props, ["allowAttachments", "files", "setFiles"])
                        : omit(props, ["allowAttachments"]))}
                />

                {showFileList && (
                    <div className="overflow-x-auto px-3 pb-1">
                        <div className="flex gap-2">
                            <AnimatePresence mode="popLayout">
                                {props.allowAttachments &&
                                    props.files?.map((file) => (
                                        <FilePreview
                                            key={file.name + String(file.lastModified)}
                                            file={file}
                                            onRemove={() => {
                                                props.setFiles((files) => {
                                                    if (!files) return null
                                                    const filtered = Array.from(files).filter(
                                                        (f) => f !== file
                                                    )
                                                    if (filtered.length === 0) return null
                                                    return filtered
                                                })
                                            }}
                                        />
                                    ))}
                            </AnimatePresence>
                        </div>
                    </div>
                )}

                <div className="flex items-center justify-between px-2 pb-2">
                    <div className="flex items-center gap-1">
                        {props.allowAttachments && (
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Attach a file"
                                onClick={async () => {
                                    const files = await showFileUploadDialog()
                                    addFiles(files)
                                }}
                            >
                                <Paperclip className="h-4 w-4" />
                            </Button>
                        )}
                        {isSpeechSupported && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className={cn(isListening && "text-primary")}
                                aria-label="Voice input"
                                onClick={toggleListening}
                            >
                                <Mic className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        {isGenerating && stop ? (
                            <Button
                                type="button"
                                size="icon-sm"
                                aria-label="Stop generating"
                                onClick={stop}
                            >
                                <Square className="h-3 w-3" fill="currentColor" />
                            </Button>
                        ) : (
                            <Button
                                type="submit"
                                size="icon-sm"
                                aria-label="Send message"
                                disabled={props.value === "" || isGenerating}
                            >
                                <ArrowUp className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>

                {props.allowAttachments && <FileUploadOverlay isDragging={isDragging} />}

                <RecordingControls
                    isRecording={isRecording}
                    isTranscribing={isTranscribing}
                    audioStream={audioStream}
                    onStopRecording={stopRecording}
                />
            </div>
        </div>
    )
}
MessageInput.displayName = "MessageInput"

interface FileUploadOverlayProps {
    isDragging: boolean
}

function FileUploadOverlay({ isDragging }: FileUploadOverlayProps) {
    return (
        <AnimatePresence>
            {isDragging && (
                <motion.div
                    className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center space-x-2 rounded-md border border-dashed border-border bg-background text-sm text-muted-foreground"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    aria-hidden
                >
                    <Paperclip className="h-4 w-4" />
                    <span>Drop your files here to attach them.</span>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

function showFileUploadDialog() {
    const input = document.createElement("input")

    input.type = "file"
    input.multiple = true
    input.accept = "*/*"
    input.click()

    return new Promise<File[] | null>((resolve) => {
        input.onchange = (e) => {
            const files = (e.currentTarget as HTMLInputElement).files

            if (files) {
                resolve(Array.from(files))
                return
            }

            resolve(null)
        }
    })
}

function TranscribingOverlay() {
    return (
        <motion.div
            className="flex h-full w-full flex-col items-center justify-center rounded-md bg-background/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
        >
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-sm font-medium text-muted-foreground">
                Transcribing audio...
            </p>
        </motion.div>
    )
}

interface RecordingPromptProps {
    isVisible: boolean
    onStopRecording: () => void
}

function RecordingPrompt({ isVisible, onStopRecording }: RecordingPromptProps) {
    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ top: 0, filter: "blur(5px)" }}
                    animate={{
                        top: -40,
                        filter: "blur(0px)",
                        transition: {
                            type: "spring",
                            filter: { type: "tween" },
                        },
                    }}
                    exit={{ top: 0, filter: "blur(5px)" }}
                    className="absolute left-1/2 flex -translate-x-1/2 cursor-pointer overflow-hidden whitespace-nowrap rounded-full border bg-background py-1 text-center text-sm text-muted-foreground"
                    onClick={onStopRecording}
                >
                    <span className="mx-2.5 flex items-center">
                        <Info className="mr-2 h-3 w-3" />
                        Click to finish recording
                    </span>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

interface RecordingControlsProps {
    isRecording: boolean
    isTranscribing: boolean
    audioStream: MediaStream | null
    onStopRecording: () => void
}

function RecordingControls({
    isRecording,
    isTranscribing,
    audioStream,
    onStopRecording,
}: RecordingControlsProps) {
    if (isRecording) {
        return (
            <div className="absolute inset-0 z-50 overflow-hidden rounded-md">
                <AudioVisualizer
                    stream={audioStream}
                    isRecording={isRecording}
                    onClick={onStopRecording}
                />
            </div>
        )
    }

    if (isTranscribing) {
        return (
            <div className="absolute inset-0 z-50 overflow-hidden rounded-md">
                <TranscribingOverlay />
            </div>
        )
    }

    return null
}
