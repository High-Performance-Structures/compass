"use client"

import { LoaderIcon, MicIcon, SquareIcon } from "lucide-react"
import { type ComponentProps, useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null
  onend: ((this: SpeechRecognition, ev: Event) => void) | null
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  readonly length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
  isFinal: boolean
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
}

declare global {
  interface Window {
    SpeechRecognition: { new (): SpeechRecognition }
    webkitSpeechRecognition: { new (): SpeechRecognition }
  }
}

type SpeechInputMode = "speech-recognition" | "media-recorder" | "none"

export type SpeechInputProps = ComponentProps<typeof Button> & {
  onTranscriptionChange?: (text: string) => void
  onAudioRecorded?: (audioBlob: Blob) => Promise<string>
  lang?: string
}

const detectSpeechInputMode = (): SpeechInputMode => {
  if (typeof window === "undefined") {
    return "none"
  }

  if ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) {
    return "speech-recognition"
  }

  if ("MediaRecorder" in window && "mediaDevices" in navigator) {
    return "media-recorder"
  }

  return "none"
}

export const SpeechInput = ({
  className,
  onTranscriptionChange,
  onAudioRecorded,
  lang = "en-US",
  ...props
}: SpeechInputProps) => {
  const [isListening, setIsListening] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [mode, setMode] = useState<SpeechInputMode>("none")
  const [recognition, setRecognition] = useState<SpeechRecognition | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  useEffect(() => {
    setMode(detectSpeechInputMode())
  }, [])

  useEffect(() => {
    if (mode !== "speech-recognition") {
      return
    }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    const speechRecognition = new SpeechRecognitionCtor()

    speechRecognition.continuous = true
    speechRecognition.interimResults = true
    speechRecognition.lang = lang

    speechRecognition.onstart = () => {
      setIsListening(true)
    }

    speechRecognition.onend = () => {
      setIsListening(false)
    }

    speechRecognition.onresult = event => {
      let finalTranscript = ""

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalTranscript += result[0]?.transcript ?? ""
        }
      }

      if (finalTranscript) {
        onTranscriptionChange?.(finalTranscript)
      }
    }

    speechRecognition.onerror = event => {
      // Network/permission errors are common - use warn to avoid error overlay
      if (event.error !== "network" && event.error !== "not-allowed") {
        console.warn("Speech recognition error:", event.error)
      }
      setIsListening(false)
    }

    recognitionRef.current = speechRecognition
    setRecognition(speechRecognition)

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [mode, onTranscriptionChange, lang])

  const startMediaRecorder = useCallback(async () => {
    if (!onAudioRecorded) {
      console.warn("SpeechInput: onAudioRecorded callback is required for MediaRecorder fallback")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        for (const track of stream.getTracks()) {
          track.stop()
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" })

        if (audioBlob.size > 0) {
          setIsProcessing(true)
          try {
            const transcript = await onAudioRecorded(audioBlob)
            if (transcript) {
              onTranscriptionChange?.(transcript)
            }
          } catch (error) {
            console.error("Transcription error:", error)
          } finally {
            setIsProcessing(false)
          }
        }
      }

      mediaRecorder.onerror = () => {
        setIsListening(false)
        for (const track of stream.getTracks()) {
          track.stop()
        }
      }

      mediaRecorderRef.current = mediaRecorder
      mediaRecorder.start()
      setIsListening(true)
    } catch (error) {
      console.error("Failed to start MediaRecorder:", error)
      setIsListening(false)
    }
  }, [onAudioRecorded, onTranscriptionChange])

  const stopMediaRecorder = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop()
    }
    setIsListening(false)
  }, [])

  const toggleListening = useCallback(() => {
    if (mode === "speech-recognition" && recognition) {
      if (isListening) {
        recognition.stop()
      } else {
        recognition.start()
      }
    } else if (mode === "media-recorder") {
      if (isListening) {
        stopMediaRecorder()
      } else {
        startMediaRecorder()
      }
    }
  }, [mode, recognition, isListening, startMediaRecorder, stopMediaRecorder])

  const isDisabled =
    mode === "none" ||
    (mode === "speech-recognition" && !recognition) ||
    (mode === "media-recorder" && !onAudioRecorded) ||
    isProcessing

  return (
    <div className="relative inline-flex items-center justify-center">
      {isListening &&
        [0, 1, 2].map(index => (
          <div
            className="absolute inset-0 animate-ping rounded-full border-2 border-red-400/30"
            key={index}
            style={{
              animationDelay: `${index * 0.3}s`,
              animationDuration: "2s",
            }}
          />
        ))}

      <Button
        className={cn(
          "relative z-10 rounded-full transition-all duration-300",
          isListening
            ? "bg-destructive text-white hover:bg-destructive/80 hover:text-white"
            : "bg-primary text-primary-foreground hover:bg-primary/80 hover:text-primary-foreground",
          className,
        )}
        disabled={isDisabled}
        onClick={toggleListening}
        {...props}
      >
        {isProcessing && <LoaderIcon className="size-4 animate-spin" />}
        {!isProcessing && isListening && <SquareIcon className="size-4" />}
        {!(isProcessing || isListening) && <MicIcon className="size-4" />}
      </Button>
    </div>
  )
}

/** Demo component for preview */
export default function SpeechInputDemo() {
  const [transcript, setTranscript] = useState("")

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4 p-4">
      <SpeechInput
        size="lg"
        onTranscriptionChange={text => setTranscript(prev => prev + " " + text)}
      />
      <div className="w-full rounded-lg border bg-muted/50 p-4">
        <p className="text-muted-foreground text-sm">
          {transcript || "Click the microphone to start recording..."}
        </p>
      </div>
    </div>
  )
}
