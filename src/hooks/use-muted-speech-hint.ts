"use client"

import * as React from "react"

const SAMPLE_INTERVAL_MS = 150
const SPEECH_THRESHOLD = 0.04
/** Consecutive loud samples (~600 ms) before treating it as speech. */
const SPEECH_SAMPLES = 4
const HINT_COOLDOWN_MS = 20_000

/**
 * Opt-in "you're talking while muted" detection. Muting releases the meeting
 * microphone, so this opens a separate local-only stream while `active`.
 * Nothing is published to the meeting, but the browser shows the microphone
 * as in use, which is why the preference is off by default.
 */
export function useMutedSpeechHint({
  active,
  microphoneId,
  onSpeech,
}: {
  readonly active: boolean
  readonly microphoneId: string
  readonly onSpeech: () => void
}): void {
  const onSpeechRef = React.useRef(onSpeech)
  onSpeechRef.current = onSpeech

  React.useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.mediaDevices) return
    let cancelled = false
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let timer: number | null = null

    void (async () => {
      try {
        const opened = await navigator.mediaDevices.getUserMedia({
          audio: microphoneId ? { deviceId: { ideal: microphoneId } } : true,
          video: false,
        })
        if (cancelled) {
          // Deactivated while the browser was opening the microphone.
          for (const track of opened.getTracks()) track.stop()
          return
        }
        stream = opened
        context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 512
        context.createMediaStreamSource(stream).connect(analyser)
        const samples = new Uint8Array(analyser.fftSize)
        let loudSamples = 0
        let lastHintAt = 0
        timer = window.setInterval(() => {
          analyser.getByteTimeDomainData(samples)
          let energy = 0
          for (const sample of samples) {
            const centered = (sample - 128) / 128
            energy += centered * centered
          }
          const loud = Math.sqrt(energy / samples.length) >= SPEECH_THRESHOLD
          loudSamples = loud ? loudSamples + 1 : 0
          const now = Date.now()
          if (loudSamples >= SPEECH_SAMPLES && now - lastHintAt >= HINT_COOLDOWN_MS) {
            lastHintAt = now
            loudSamples = 0
            onSpeechRef.current()
          }
        }, SAMPLE_INTERVAL_MS)
      } catch {
        // Microphone unavailable or denied: the hint is a convenience, so skip it.
      }
    })()

    return () => {
      cancelled = true
      if (timer !== null) window.clearInterval(timer)
      for (const track of stream?.getTracks() ?? []) track.stop()
      void context?.close().catch(() => {})
    }
  }, [active, microphoneId])
}
