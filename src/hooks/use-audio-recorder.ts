"use client"

import { useState, useRef, useCallback, useEffect } from "react"

type RecorderState = "idle" | "recording" | "transcribing"

export interface AudioRecorder {
  readonly state: RecorderState
  readonly stream: MediaStream | null
  readonly supported: boolean
  start(): void
  stop(): void
  cancel(): void
}

export function useAudioRecorder(
  onTranscription: (text: string) => void
): AudioRecorder {
  const [state, setState] = useState<RecorderState>("idle")
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [supported, setSupported] = useState(true)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const cancelledRef = useRef(false)
  const callbackRef = useRef(onTranscription)
  callbackRef.current = onTranscription

  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices
    ) {
      setSupported(false)
    }
    return () => {
      recorderRef.current?.stream
        .getTracks()
        .forEach((t) => t.stop())
    }
  }, [])

  const start = useCallback(async () => {
    try {
      cancelledRef.current = false
      const mediaStream =
        await navigator.mediaDevices.getUserMedia({
          audio: true,
        })
      setStream(mediaStream)
      chunksRef.current = []

      const mimeType = MediaRecorder.isTypeSupported(
        "audio/webm;codecs=opus"
      )
        ? "audio/webm;codecs=opus"
        : "audio/webm"

      const recorder = new MediaRecorder(mediaStream, {
        mimeType,
      })
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        mediaStream.getTracks().forEach((t) => t.stop())
        setStream(null)

        if (cancelledRef.current) {
          chunksRef.current = []
          setState("idle")
          return
        }

        const blob = new Blob(chunksRef.current, {
          type: mimeType,
        })
        chunksRef.current = []

        if (blob.size === 0) {
          setState("idle")
          return
        }

        setState("transcribing")
        try {
          const form = new FormData()
          form.append("audio", blob, "recording.webm")
          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: form,
          })
          if (res.ok) {
            const data = (await res.json()) as {
              text: string
              duration: number
            }
            const text = data.text.trim()
            if (text) {
              callbackRef.current(text)
            }
          }
        } finally {
          setState("idle")
        }
      }

      recorder.start()
      setState("recording")
    } catch {
      setState("idle")
    }
  }, [])

  const stop = useCallback(() => {
    cancelledRef.current = false
    recorderRef.current?.stop()
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    recorderRef.current?.stop()
  }, [])

  return { state, stream, supported, start, stop, cancel }
}
