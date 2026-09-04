"use client"

import * as React from "react"

const MUSIC_DUCKING_CHANNEL = "compass:music-ducking:v1"
const VOICE_ACTIVITY_THRESHOLD = 0.035
const VOICE_ACTIVITY_HOLD_MS = 1_100
const ACTIVE_SIGNAL_INTERVAL_MS = 500
const SIGNAL_EXPIRY_MS = 2_000

type VoiceActivitySignal = {
  readonly channelId: string
  readonly active: boolean
  readonly sentAt: number
}

type VoiceMeter = {
  readonly source: MediaStreamAudioSourceNode
  readonly analyser: AnalyserNode
  readonly samples: Uint8Array<ArrayBuffer>
}

function voiceActivitySignal(value: unknown): VoiceActivitySignal | null {
  if (value === null || typeof value !== "object") return null
  const channelId = Reflect.get(value, "channelId")
  const active = Reflect.get(value, "active")
  const sentAt = Reflect.get(value, "sentAt")
  if (
    typeof channelId !== "string" ||
    typeof active !== "boolean" ||
    typeof sentAt !== "number" ||
    !Number.isFinite(sentAt)
  ) {
    return null
  }
  return { channelId, active, sentAt }
}

function meterIsActive(meter: VoiceMeter): boolean {
  meter.analyser.getByteTimeDomainData(meter.samples)
  let energy = 0
  for (const sample of meter.samples) {
    const centered = (sample - 128) / 128
    energy += centered * centered
  }
  return Math.sqrt(energy / meter.samples.length) >= VOICE_ACTIVITY_THRESHOLD
}

export function useVoiceActivityPublisher({
  channelId,
  getTracks,
}: {
  readonly channelId: string | null
  readonly getTracks: () => readonly MediaStreamTrack[]
}): void {
  React.useEffect(() => {
    if (!channelId || typeof BroadcastChannel === "undefined") return

    const broadcast = new BroadcastChannel(MUSIC_DUCKING_CHANNEL)
    const audioContext = new AudioContext()
    const meters = new Map<string, VoiceMeter>()
    let lastVoiceAt = 0
    let lastSignalAt = 0
    let lastActive = false

    const publish = (active: boolean, now: number): void => {
      const signal: VoiceActivitySignal = { channelId, active, sentAt: now }
      broadcast.postMessage(signal)
      lastSignalAt = now
      lastActive = active
    }

    const syncMeters = (): void => {
      const tracks = getTracks().filter(
        (track) => track.kind === "audio" && track.readyState === "live"
      )
      const liveTrackIds = new Set(tracks.map((track) => track.id))

      for (const track of tracks) {
        if (meters.has(track.id)) continue
        const source = audioContext.createMediaStreamSource(new MediaStream([track]))
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        meters.set(track.id, {
          source,
          analyser,
          samples: new Uint8Array(analyser.fftSize),
        })
      }

      for (const [trackId, meter] of meters) {
        if (liveTrackIds.has(trackId)) continue
        meter.source.disconnect()
        meter.analyser.disconnect()
        meters.delete(trackId)
      }
    }

    const sampleVoice = (): void => {
      if (audioContext.state === "suspended") {
        void audioContext.resume().catch(() => undefined)
      }
      syncMeters()
      const now = Date.now()
      if (Array.from(meters.values()).some(meterIsActive)) lastVoiceAt = now
      const active = now - lastVoiceAt < VOICE_ACTIVITY_HOLD_MS
      if (
        active !== lastActive ||
        (active && now - lastSignalAt >= ACTIVE_SIGNAL_INTERVAL_MS)
      ) {
        publish(active, now)
      }
    }

    const interval = window.setInterval(sampleVoice, 100)
    sampleVoice()
    return () => {
      window.clearInterval(interval)
      publish(false, Date.now())
      for (const meter of meters.values()) {
        meter.source.disconnect()
        meter.analyser.disconnect()
      }
      broadcast.close()
      void audioContext.close()
    }
  }, [channelId, getTracks])
}

export function useMusicDucking(channelId: string): boolean {
  const [ducked, setDucked] = React.useState(false)

  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return
    const broadcast = new BroadcastChannel(MUSIC_DUCKING_CHANNEL)
    let expiryTimer: number | null = null

    const clearExpiry = (): void => {
      if (expiryTimer !== null) window.clearTimeout(expiryTimer)
      expiryTimer = null
    }
    const handleSignal = (event: MessageEvent): void => {
      const signal = voiceActivitySignal(event.data)
      if (!signal || signal.channelId !== channelId) return
      if (Date.now() - signal.sentAt > SIGNAL_EXPIRY_MS) return
      clearExpiry()
      setDucked(signal.active)
      if (signal.active) {
        expiryTimer = window.setTimeout(() => setDucked(false), SIGNAL_EXPIRY_MS)
      }
    }

    broadcast.addEventListener("message", handleSignal)
    return () => {
      clearExpiry()
      broadcast.removeEventListener("message", handleSignal)
      broadcast.close()
    }
  }, [channelId])

  return ducked
}
