"use client"

import * as React from "react"
import type RTKMeeting from "@cloudflare/realtimekit"
import { TalkBackgroundController } from "@/lib/realtimekit/talk-background-controller"
import {
  defaultTalkPreferences,
  parseTalkPreferences,
  talkPreferencesKey,
  TALK_BACKGROUNDS,
  type TalkPreferences
} from "@/lib/realtimekit/talk-preferences"
import type { TalkDeviceKind } from "@/components/voice/talk-settings-panel"

type TalkSettings = {
  readonly preferences: TalkPreferences
  readonly ready: boolean
  readonly busy: boolean
  readonly status: string | null
  readonly devices: readonly MediaDeviceInfo[]
  readonly update: (preferences: TalkPreferences) => void
  readonly refreshDevices: () => Promise<void>
  readonly changeDevice: (kind: TalkDeviceKind, id: string) => Promise<void>
  readonly applyBackground: (restartCamera?: boolean) => Promise<boolean>
  readonly restoreDevices: () => Promise<void>
}

export function useTalkSettings(
  meeting: RTKMeeting | undefined,
  userId: string
): TalkSettings {
  const [preferences, setPreferences] = React.useState<TalkPreferences>(
    defaultTalkPreferences
  )
  const [ready, setReady] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)
  const [storageStatus, setStorageStatus] = React.useState<string | null>(null)
  const [devices, setDevices] = React.useState<readonly MediaDeviceInfo[]>([])
  const controllerRef = React.useRef<TalkBackgroundController | null>(null)
  const preferencesRef = React.useRef(preferences)
  const mountedRef = React.useRef(true)
  const backgroundQueueRef = React.useRef<Promise<boolean>>(
    Promise.resolve(true)
  )
  const backgroundCountRef = React.useRef(0)
  const restartedTrackRef = React.useRef<MediaStreamTrack | null>(null)

  React.useEffect(() => {
    mountedRef.current = true
    try {
      const saved = parseTalkPreferences(
        localStorage.getItem(talkPreferencesKey(userId))
      )
      preferencesRef.current = saved
      setPreferences(saved)
    } catch {
      setStorageStatus(
        "Browser storage is unavailable. Choices will last for this meeting only."
      )
    }
    setReady(true)
    return () => {
      mountedRef.current = false
      restartedTrackRef.current?.stop()
    }
  }, [userId])

  React.useEffect(() => {
    if (!meeting) return
    const controller = new TalkBackgroundController(meeting)
    controllerRef.current = controller
    return () => {
      controllerRef.current = null
      void controller.dispose().catch(() => {
        /* Meeting teardown can already have removed its media. */
      })
    }
  }, [meeting])

  const refreshDevices = React.useCallback(async (): Promise<void> => {
    try {
      const available = await navigator.mediaDevices.enumerateDevices()
      if (mountedRef.current) setDevices(available)
    } catch {
      if (mountedRef.current)
        setStatus(
          "Devices could not be listed. Allow camera or microphone access, then refresh."
        )
    }
  }, [])

  React.useEffect(() => {
    void refreshDevices()
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices)
    return () =>
      navigator.mediaDevices?.removeEventListener(
        "devicechange",
        refreshDevices
      )
  }, [refreshDevices])

  const applyBackground = React.useCallback(
    (restartCamera = false): Promise<boolean> => {
      const controller = controllerRef.current
      if (!controller || !meeting) return Promise.resolve(false)
      backgroundCountRef.current += 1
      setBusy(true)
      backgroundQueueRef.current = backgroundQueueRef.current
        .then(async () => {
          if (!mountedRef.current || controllerRef.current !== controller)
            return false
          const current = preferencesRef.current
          const background = current.background
          const resumeCamera = restartCamera && meeting.self.videoEnabled
          const image =
            background.mode === "image"
              ? [...TALK_BACKGROUNDS, ...current.images].find(
                  (item) => item.id === background.imageId
                )
              : null
          let requestedTrack: MediaStreamTrack | null = null
          try {
            setStatus(
              background.mode === "none"
                ? "Turning background off…"
                : "Applying background…"
            )
            // Pause the published camera before replacing its pipeline, including when the SDK falls back to raw video.
            if (resumeCamera) await meeting.self.disableVideo()
            const result = await controller.apply(
              background,
              image?.url ?? null
            )
            if (!mountedRef.current || controllerRef.current !== controller)
              return false
            if (!result.success) {
              setStatus(result.error)
              return false
            }
            if (resumeCamera) {
              const available = await navigator.mediaDevices.enumerateDevices()
              const selected = available.some(
                (device) =>
                  device.kind === "videoinput" &&
                  device.deviceId === current.cameraId
              )
              const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: selected
                  ? { deviceId: { exact: current.cameraId } }
                  : true
              })
              requestedTrack = stream.getVideoTracks()[0] ?? null
              for (const track of stream.getTracks())
                if (track !== requestedTrack) track.stop()
              if (
                !requestedTrack ||
                !mountedRef.current ||
                controllerRef.current !== controller
              ) {
                requestedTrack?.stop()
                return false
              }
              await meeting.self.enableVideo(requestedTrack)
              if (!mountedRef.current || controllerRef.current !== controller) {
                requestedTrack.stop()
                await meeting.self.disableVideo()
                return false
              }
              if (
                !meeting.self.videoEnabled ||
                (background.mode !== "none" &&
                  meeting.self.videoTrack === meeting.self.rawVideoTrack)
              ) {
                await meeting.self.disableVideo()
                requestedTrack.stop()
                setStatus(
                  "The background could not start. Your camera is off. Retry or choose Off."
                )
                return false
              }
              restartedTrackRef.current?.stop()
              restartedTrackRef.current = requestedTrack
              requestedTrack = null
            }
            setStatus(
              background.mode === "none"
                ? "Background is off."
                : "Background applied."
            )
            return true
          } catch {
            requestedTrack?.stop()
            try {
              if (meeting.self.videoEnabled) await meeting.self.disableVideo()
            } catch {
              /* Report actual camera state below. */
            }
            if (mountedRef.current)
              setStatus(
                meeting.self.videoEnabled
                  ? "Background failed and the camera could not stop. Turn the camera off or leave the call."
                  : "The background could not start. Your camera is off. Retry or choose Off."
              )
            return false
          }
        })
        .finally(() => {
          backgroundCountRef.current -= 1
          if (mountedRef.current && backgroundCountRef.current === 0)
            setBusy(false)
        })
      return backgroundQueueRef.current
    },
    [meeting]
  )

  const update = React.useCallback(
    (next: TalkPreferences): void => {
      const backgroundChanged =
        JSON.stringify(next.background) !==
        JSON.stringify(preferencesRef.current.background)
      preferencesRef.current = next
      setPreferences(next)
      try {
        localStorage.setItem(talkPreferencesKey(userId), JSON.stringify(next))
        setStorageStatus(null)
      } catch {
        setStorageStatus(
          "Your choice works for this meeting, but browser storage is full or unavailable. Remove a personal image to make space."
        )
      }
      if (backgroundChanged && meeting?.self.videoEnabled)
        void applyBackground(true)
    },
    [userId, meeting, applyBackground]
  )

  const restoreDevices = React.useCallback(async (): Promise<void> => {
    if (!meeting) return
    const available = await navigator.mediaDevices.enumerateDevices()
    const speaker = available.find(
      (item) =>
        item.kind === "audiooutput" &&
        item.deviceId === preferencesRef.current.speakerId
    )
    if (speaker) {
      try {
        await meeting.self.setDevice(speaker)
      } catch {
        if (mountedRef.current)
          setStatus(
            "Preferred speakers are unavailable. Using your system default."
          )
      }
    }
    if (mountedRef.current) setDevices(available)
  }, [meeting])

  const changeDevice = React.useCallback(
    async (kind: TalkDeviceKind, id: string): Promise<void> => {
      if (!meeting) return
      const deviceKind =
        kind === "cameraId"
          ? "videoinput"
          : kind === "microphoneId"
            ? "audioinput"
            : "audiooutput"
      setBusy(true)
      try {
        const available = await navigator.mediaDevices.enumerateDevices()
        const device =
          available.find(
            (item) =>
              item.kind === deviceKind &&
              (id ? item.deviceId === id : item.deviceId === "default")
          ) ??
          (!id ? available.find((item) => item.kind === deviceKind) : undefined)
        if (!device && id) {
          setStatus(
            "That device is no longer available. Refresh devices or choose System default."
          )
          return
        }
        if (
          device &&
          (kind === "speakerId" ||
            (kind === "cameraId"
              ? meeting.self.videoEnabled
              : meeting.self.audioEnabled))
        )
          await meeting.self.setDevice(device)
        update({ ...preferencesRef.current, [kind]: id })
        await refreshDevices()
        setStatus("Device preference saved.")
      } catch {
        setStatus(
          "This device could not be selected. Check browser permissions or try another device."
        )
      } finally {
        if (mountedRef.current) setBusy(false)
      }
    },
    [meeting, update, refreshDevices]
  )

  return {
    preferences,
    ready,
    busy,
    status: storageStatus ?? status,
    devices,
    update,
    refreshDevices,
    changeDevice,
    applyBackground,
    restoreDevices
  }
}
