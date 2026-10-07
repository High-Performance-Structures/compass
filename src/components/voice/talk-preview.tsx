"use client"

import * as React from "react"
import type RTKMeeting from "@cloudflare/realtimekit"
import { Button } from "@/components/ui/button"

export function TalkPreview({
  meeting,
  videoEnabled,
  audioEnabled,
  speakerId
}: {
  readonly meeting: RTKMeeting
  readonly videoEnabled: boolean
  readonly audioEnabled: boolean
  readonly speakerId: string
}): React.ReactElement {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const testContextRef = React.useRef<AudioContext | null>(null)
  const [deviceRevision, setDeviceRevision] = React.useState(0)
  const [level, setLevel] = React.useState(0)
  const [audioStatus, setAudioStatus] = React.useState<string | null>(null)

  React.useEffect(() => {
    const changed = (): void => setDeviceRevision((value) => value + 1)
    meeting.self.on("deviceUpdate", changed)
    meeting.self.on("audioUpdate", changed)
    return () => {
      meeting.self.off("deviceUpdate", changed)
      meeting.self.off("audioUpdate", changed)
    }
  }, [meeting])

  React.useEffect(() => {
    const element = videoRef.current
    if (!element || !videoEnabled) return
    meeting.self.registerVideoElement(element, true)
    return () => {
      meeting.self.deregisterVideoElement(element, true)
    }
  }, [meeting, videoEnabled])

  React.useEffect(() => {
    if (!audioEnabled || !meeting.self.audioTrack) {
      setLevel(0)
      return
    }
    const context = new AudioContext()
    const source = context.createMediaStreamSource(
      new MediaStream([meeting.self.audioTrack])
    )
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    let frame = 0
    const measure = (): void => {
      analyser.getByteTimeDomainData(samples)
      const rms = Math.sqrt(
        samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) /
          samples.length
      )
      setLevel(Math.min(100, Math.round(rms * 300)))
      frame = requestAnimationFrame(measure)
    }
    measure()
    void context
      .resume()
      .catch(() =>
        setAudioStatus("Click Test speakers to enable browser audio.")
      )
    return () => {
      cancelAnimationFrame(frame)
      source.disconnect()
      void context.close().catch(() => {})
    }
  }, [meeting, audioEnabled, deviceRevision])

  React.useEffect(
    () => () => {
      void testContextRef.current?.close().catch(() => {})
    },
    []
  )

  const testSpeakers = async (): Promise<void> => {
    try {
      await testContextRef.current?.close()
      const context = new AudioContext()
      testContextRef.current = context
      if (
        speakerId &&
        "setSinkId" in context &&
        typeof context.setSinkId === "function"
      ) {
        await context.setSinkId(speakerId)
      } else if (speakerId) {
        setAudioStatus(
          "This browser plays the test through your system default speakers."
        )
      } else {
        setAudioStatus("Playing a short test tone.")
      }
      await context.resume()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      gain.gain.value = 0.08
      oscillator.frequency.value = 440
      oscillator.connect(gain).connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.4)
      oscillator.onended = () => {
        void context.close().catch(() => {})
        if (testContextRef.current === context) testContextRef.current = null
      }
    } catch {
      setAudioStatus(
        "The speaker test could not play. Check your browser's audio permissions."
      )
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="size-full object-contain"
          aria-label="Your camera preview"
        />
        {!videoEnabled ? (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            Camera is off
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs">
          Microphone {audioEnabled ? "level" : "is off"}
        </span>
        <meter
          min={0}
          max={100}
          value={level}
          className="flex-1"
          aria-label="Microphone input level"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => void testSpeakers()}
      >
        Test speakers
      </Button>
      {audioStatus ? (
        <p role="status" className="text-xs text-muted-foreground">
          {audioStatus}
        </p>
      ) : null}
    </div>
  )
}
