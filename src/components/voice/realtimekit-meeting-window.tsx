"use client"

import * as React from "react"
import { useRealtimeKitClient } from "@cloudflare/realtimekit-react"
import { createDefaultConfig, RtkMeeting } from "@cloudflare/realtimekit-react-ui"
import type { UIConfig } from "@cloudflare/realtimekit-react-ui"
import { sendMessage } from "@/app/actions/chat-messages"
import { joinRealtimeKitVoiceSession } from "@/app/actions/voice-sessions"
import { installRealtimeKitBrowserApiProxy } from "@/lib/realtimekit/browser-api-proxy"

type TranscriptEntry = {
  readonly id: string
  readonly name: string
  readonly transcript: string
  readonly isPartialTranscript: boolean
  readonly date: Date
}

type VideoBackgroundAddonHandle = {
  readonly unregister: () => void | Promise<void>
}

type ScreenShareStatus =
  | "idle"
  | "starting"
  | "sharing"
  | "stopping"
  | "blocked"
  | "error"

type MediaButtonStatus = "idle" | "starting" | "stopping" | "error"
type MeetingToolSelector =
  | "rtk-chat-toggle"
  | "rtk-participants-toggle"
  | "rtk-settings-toggle"

const MEETING_BACKGROUND_IMAGES = [
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 900'%3E%3Cdefs%3E%3ClinearGradient id='a' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop stop-color='%2320170f'/%3E%3Cstop offset='.46' stop-color='%234f2f13'/%3E%3Cstop offset='1' stop-color='%233f7d4d'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect fill='url(%23a)' width='1600' height='900'/%3E%3Ccircle cx='1320' cy='160' r='260' fill='%23ffffff' opacity='.12'/%3E%3Cpath d='M0 760 C360 620 580 820 900 680 C1170 562 1320 620 1600 470 L1600 900 L0 900 Z' fill='%230b120d' opacity='.45'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 900'%3E%3Cdefs%3E%3ClinearGradient id='b' x1='0' x2='1'%3E%3Cstop stop-color='%230f172a'/%3E%3Cstop offset='.52' stop-color='%233f7d4d'/%3E%3Cstop offset='1' stop-color='%239c7426'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect fill='url(%23b)' width='1600' height='900'/%3E%3Cpath d='M160 710 L520 350 L840 700 L1050 480 L1450 720 Z' fill='%23ffffff' opacity='.15'/%3E%3Cpath d='M0 720 H1600 V900 H0 Z' fill='%23050505' opacity='.38'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 900'%3E%3Crect fill='%230f1a13' width='1600' height='900'/%3E%3Cpath d='M0 130 H1600' stroke='%233f7d4d' stroke-width='4' opacity='.35'/%3E%3Cpath d='M0 300 H1600M0 470 H1600M0 640 H1600' stroke='%23ffffff' stroke-width='2' opacity='.12'/%3E%3Cpath d='M280 0 V900M620 0 V900M960 0 V900M1300 0 V900' stroke='%23ffffff' stroke-width='2' opacity='.10'/%3E%3Ccircle cx='1250' cy='220' r='150' fill='%239c7426' opacity='.30'/%3E%3C/svg%3E",
]

function createCompassMeetingConfig(): UIConfig {
  const base = createDefaultConfig()
  return {
    ...base,
    designTokens: {
      ...base.designTokens,
      theme: "dark",
      borderRadius: "rounded",
      colors: {
        ...base.designTokens?.colors,
        brand: {
          ...base.designTokens?.colors?.brand,
          300: "#9bd3a8",
          400: "#63b878",
          500: "#3f7d4d",
          600: "#32663e",
          700: "#244d2d",
        },
        background: {
          ...base.designTokens?.colors?.background,
          1000: "#08110b",
          900: "#0e1a12",
          800: "#142419",
          700: "#203626",
          600: "#2d4a34",
        },
        text: "#f8fafc",
        "text-on-brand": "#ffffff",
        danger: "#ef4444",
        success: "#22c55e",
        warning: "#f59e0b",
        "video-bg": "#050805",
      },
    },
    config: {
      ...base.config,
      videoFit: "contain",
      notification_sounds: {
        ...base.config?.notification_sounds,
        participant_joined: false,
        participant_left: false,
      },
    },
    root: {
      ...base.root,
      "rtk-stage": {
        states: ["activeSidebar"],
        children: ["rtk-grid", "rtk-notifications"],
      },
      "div#controlbar-left": ["rtk-settings-toggle", "rtk-screen-share-toggle"],
      "div#controlbar-center": [
        "rtk-mic-toggle",
        "rtk-camera-toggle",
        "rtk-more-toggle",
        "rtk-leave-button",
      ],
      "div#controlbar-right": [
        "rtk-chat-toggle",
        "rtk-participants-toggle",
        "rtk-plugins-toggle",
      ],
      "rtk-more-toggle.activeMoreMenu": [
        ["rtk-fullscreen-toggle", { variant: "horizontal", slot: "more-elements" }],
        ["rtk-pip-toggle", { variant: "horizontal", slot: "more-elements" }],
        ["rtk-mute-all-button", { variant: "horizontal", slot: "more-elements" }],
        [
          "rtk-breakout-rooms-toggle",
          { variant: "horizontal", slot: "more-elements" },
        ],
        ["rtk-recording-toggle", { variant: "horizontal", slot: "more-elements" }],
        ["rtk-debugger-toggle", { variant: "horizontal" }],
      ],
      "rtk-more-toggle.activeMoreMenu.md": [
        ["rtk-chat-toggle", { variant: "horizontal", slot: "more-elements" }],
        [
          "rtk-participants-toggle",
          { variant: "horizontal", slot: "more-elements" },
        ],
        ["rtk-settings-toggle", { variant: "horizontal", slot: "more-elements" }],
        ["rtk-plugins-toggle", { variant: "horizontal", slot: "more-elements" }],
        ["rtk-fullscreen-toggle", { variant: "horizontal", slot: "more-elements" }],
        ["rtk-pip-toggle", { variant: "horizontal", slot: "more-elements" }],
        ["rtk-mute-all-button", { variant: "horizontal", slot: "more-elements" }],
        [
          "rtk-breakout-rooms-toggle",
          { variant: "horizontal", slot: "more-elements" },
        ],
      ],
      "rtk-more-toggle.activeMoreMenu.sm": [
        ["rtk-chat-toggle", { variant: "horizontal", slot: "more-elements" }],
        [
          "rtk-participants-toggle",
          { variant: "horizontal", slot: "more-elements" },
        ],
        ["rtk-settings-toggle", { variant: "horizontal", slot: "more-elements" }],
        ["rtk-plugins-toggle", { variant: "horizontal", slot: "more-elements" }],
        ["rtk-fullscreen-toggle", { variant: "horizontal", slot: "more-elements" }],
        ["rtk-pip-toggle", { variant: "horizontal", slot: "more-elements" }],
      ],
      "div#controlbar-mobile": [
        "rtk-mic-toggle",
        "rtk-camera-toggle",
        "rtk-leave-button",
        "rtk-more-toggle",
      ],
    },
    styles: {
      ...base.styles,
      "rtk-controlbar": {
        ...base.styles?.["rtk-controlbar"],
        backgroundColor: "rgba(8, 17, 11, 0.92)",
        border: "1px solid rgba(255, 255, 255, 0.18)",
        boxShadow: "0 18px 50px rgba(0, 0, 0, 0.42)",
      },
      "rtk-controlbar-button": {
        ...base.styles?.["rtk-controlbar-button"],
        color: "#f8fafc",
      },
      "rtk-more-toggle": {
        ...base.styles?.["rtk-more-toggle"],
        color: "#f8fafc",
      },
      "rtk-settings-toggle": {
        ...base.styles?.["rtk-settings-toggle"],
        color: "#f8fafc",
      },
      "rtk-chat-toggle": {
        ...base.styles?.["rtk-chat-toggle"],
        color: "#f8fafc",
      },
      "rtk-participants-toggle": {
        ...base.styles?.["rtk-participants-toggle"],
        color: "#f8fafc",
      },
    },
  }
}

function transcriptKey(entry: TranscriptEntry): string {
  return entry.id.length > 0
    ? entry.id
    : `${entry.name}-${entry.date.toISOString()}-${entry.transcript}`
}

function mergeTranscript(
  current: readonly TranscriptEntry[],
  entry: TranscriptEntry
): readonly TranscriptEntry[] {
  const key = transcriptKey(entry)
  const next = current.filter((item) => transcriptKey(item) !== key)
  return [...next, entry].sort((a, b) => a.date.getTime() - b.date.getTime())
}

function transcriptText(entries: readonly TranscriptEntry[]): string {
  return entries
    .filter((entry) => !entry.isPartialTranscript)
    .map((entry) => {
      const time = entry.date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
      return `[${time}] ${entry.name}: ${entry.transcript}`
    })
    .join("\n")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function linesToHtml(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(escapeHtml)
    .join("<br>")
}

function errorMessageForCause(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message
  }
  if (cause !== null && typeof cause === "object") {
    const message = Reflect.get(cause, "message")
    if (typeof message === "string" && message.trim().length > 0) {
      return message
    }
  }
  return "Failed to open the Cloudflare meeting"
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function recordValue(
  record: Readonly<Record<string, unknown>>,
  key: string
): unknown {
  return record[key]
}

function realtimeKitErrorDetails(cause: unknown): Readonly<Record<string, unknown>> {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      stack: cause.stack,
    }
  }
  if (cause !== null && typeof cause === "object") {
    const ownProperties: Record<string, unknown> = {}
    for (const key of Object.getOwnPropertyNames(cause)) {
      ownProperties[key] = Reflect.get(cause, key)
    }
    return {
      type: Object.prototype.toString.call(cause),
      name: Reflect.get(cause, "name"),
      message: Reflect.get(cause, "message"),
      code: Reflect.get(cause, "code"),
      stack: Reflect.get(cause, "stack"),
      cause: Reflect.get(cause, "cause"),
      ownProperties,
      stringValue: String(cause),
    }
  }
  return { cause }
}

function safeDiagnosticJson(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (_key: string, item: unknown): unknown => {
    if (item !== null && typeof item === "object") {
      if (seen.has(item)) return "[Circular]"
      seen.add(item)
    }
    return item
  })
}

function recordRealtimeKitDiagnostic(
  event: string,
  payload: Readonly<Record<string, unknown>>
): void {
  if (typeof window !== "undefined") {
    const existing = Reflect.get(window, "__compassRealtimeKitDiagnostics")
    const diagnostics = Array.isArray(existing) ? existing : []
    const nextDiagnostics = [
      ...diagnostics,
      { event, payload },
    ]
    Reflect.set(window, "__compassRealtimeKitDiagnostics", nextDiagnostics)
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute(
        "data-compass-realtimekit-diagnostics",
        safeDiagnosticJson(nextDiagnostics)
      )
    }
  }
  console.info(`RealtimeKit diagnostic: ${event}`, payload)
}

async function runtimeAssetAvailable(path: string): Promise<boolean> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(path, {
      method: "GET",
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    window.clearTimeout(timeout)
  }
}

async function videoBackgroundRuntimeAvailable(): Promise<boolean> {
  const [tflite, tfliteSimd] = await Promise.all([
    runtimeAssetAvailable("/tflite.wasm"),
    runtimeAssetAvailable("/tflite-simd.wasm"),
  ])
  return tflite && tfliteSimd
}

export function RealtimeKitMeetingWindow({
  channelId,
}: {
  readonly channelId: string
}): React.ReactElement {
  const [meeting, initMeeting] = useRealtimeKitClient({ resetOnLeave: true })
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [meetingTitle, setMeetingTitle] = React.useState("Compass Talk")
  const [meetingConfig, setMeetingConfig] = React.useState<UIConfig>(() =>
    createCompassMeetingConfig()
  )
  const [notes, setNotes] = React.useState("")
  const [notesStatus, setNotesStatus] = React.useState<string | null>(null)
  const [activePanel, setActivePanel] = React.useState<"notes" | "transcript">(
    "notes"
  )
  const [transcripts, setTranscripts] = React.useState<readonly TranscriptEntry[]>(
    []
  )
  const [transcriptEnabled, setTranscriptEnabled] = React.useState(false)
  const [screenShareStatus, setScreenShareStatus] =
    React.useState<ScreenShareStatus>("idle")
  const [screenShareMessage, setScreenShareMessage] = React.useState<string | null>(
    null
  )
  const [audioEnabled, setAudioEnabled] = React.useState(false)
  const [videoEnabled, setVideoEnabled] = React.useState(false)
  const [audioStatus, setAudioStatus] =
    React.useState<MediaButtonStatus>("idle")
  const [videoStatus, setVideoStatus] =
    React.useState<MediaButtonStatus>("idle")
  const [backgroundStatus, setBackgroundStatus] = React.useState<string | null>(
    null
  )
  const [canScreenShare, setCanScreenShare] = React.useState(false)
  const addonRef = React.useRef<VideoBackgroundAddonHandle | null>(null)

  React.useEffect(() => {
    setCanScreenShare(
      typeof navigator !== "undefined" &&
        typeof navigator.mediaDevices?.getDisplayMedia === "function"
    )
  }, [])

  React.useEffect(() => {
    let isCurrent = true
    const uninstallApiProxy = installRealtimeKitBrowserApiProxy()
    setLoading(true)
    setError(null)

    const openMeeting = async (
      resetMeeting: boolean
    ): Promise<void> => {
      const result = await joinRealtimeKitVoiceSession(channelId, {
        resetMeeting,
      })
      if (!isCurrent) return
      if (!result.success) {
        throw new Error(result.error)
      }

      setMeetingTitle(result.data.meetingTitle)
      recordRealtimeKitDiagnostic("join-payload", {
        meetingId: result.data.meetingId,
        meetingTitle: result.data.meetingTitle,
        presetName: result.data.cachedUserDetails.userDetails.preset.name,
        socketBaseUri:
          result.data.cachedUserDetails.userDetails.socket.baseUri,
        iceServerCount: result.data.cachedUserDetails.iceServers.length,
      })
      const initializedMeeting = await initMeeting({
        authToken: result.data.authToken,
        cachedUserDetails: result.data.cachedUserDetails,
        onError: (clientError) => {
          recordRealtimeKitDiagnostic(
            "client-error",
            realtimeKitErrorDetails(clientError)
          )
        },
        defaults: {
          audio: false,
          video: false,
        },
      })
      if (!initializedMeeting) {
        throw new Error("Cloudflare meeting did not initialize.")
      }
      if (!initializedMeeting.self.roomJoined) {
        await initializedMeeting.join()
      }
    }

    void (async () => {
      try {
        await openMeeting(false)
      } catch (firstCause: unknown) {
        if (!isCurrent) return
        try {
          await openMeeting(true)
        } catch (secondCause: unknown) {
          if (!isCurrent) return
          recordRealtimeKitDiagnostic("open-failed", {
            first: realtimeKitErrorDetails(firstCause),
            second: realtimeKitErrorDetails(secondCause),
          })
          setError(errorMessageForCause(secondCause ?? firstCause))
          setLoading(false)
          return
        }
      }
      if (isCurrent) setLoading(false)
    })().catch((cause: unknown) => {
      if (!isCurrent) return
      setError(errorMessageForCause(cause))
      setLoading(false)
    })

    return () => {
      isCurrent = false
      uninstallApiProxy()
    }
  }, [channelId, initMeeting])

  React.useEffect(() => {
    document.title = meetingTitle
  }, [meetingTitle])

  React.useEffect(() => {
    if (!meeting) return

    let isCurrent = true
    void (async () => {
      const runtimeAvailable = await videoBackgroundRuntimeAvailable()
      if (!runtimeAvailable) {
        recordRealtimeKitDiagnostic("background-runtime-unavailable", {
          requiredAssets: ["/tflite.wasm", "/tflite-simd.wasm"],
        })
        if (isCurrent) {
          setBackgroundStatus(
            "Background effects are paused while the video ML runtime is added."
          )
        }
        return
      }

      const [{ default: VideoBackgroundAddon }, { registerAddons }] =
        await Promise.all([
          import("@cloudflare/realtimekit-ui-addons/video-background"),
          import("@cloudflare/realtimekit-ui"),
        ])
      if (!isCurrent) return

      const backgroundAddon = await VideoBackgroundAddon.init({
        meeting,
        modes: ["blur", "virtual", "random", "none"],
        randomCount: 3,
        blurStrength: 45,
        buttonLabel: "Background",
        images: MEETING_BACKGROUND_IMAGES,
      })
      if (!isCurrent) {
        await backgroundAddon.unregister()
        return
      }

      addonRef.current = backgroundAddon
      setBackgroundStatus(null)
      setMeetingConfig(
        registerAddons(
          [backgroundAddon],
          meeting,
          createCompassMeetingConfig()
        )
      )
    })().catch((cause: unknown) => {
      recordRealtimeKitDiagnostic("background-addon-failed", {
        error: realtimeKitErrorDetails(cause),
      })
      if (isCurrent) {
        setBackgroundStatus("Background effects could not start in this browser.")
      }
    })

    return () => {
      isCurrent = false
      const addon = addonRef.current
      addonRef.current = null
      if (addon) void addon.unregister()
      setMeetingConfig(createCompassMeetingConfig())
    }
  }, [meeting])

  React.useEffect(() => {
    if (!meeting) return

    const handleAudioUpdate = (payload: {
      readonly audioEnabled: boolean
    }): void => {
      setAudioEnabled(payload.audioEnabled)
      setAudioStatus("idle")
      recordRealtimeKitDiagnostic("audio-update", {
        enabled: payload.audioEnabled,
      })
    }

    const handleVideoUpdate = (payload: {
      readonly videoEnabled: boolean
    }): void => {
      setVideoEnabled(payload.videoEnabled)
      setVideoStatus("idle")
      recordRealtimeKitDiagnostic("video-update", {
        enabled: payload.videoEnabled,
      })
    }

    const handleScreenShareUpdate = (payload: {
      readonly screenShareEnabled: boolean
    }): void => {
      setScreenShareStatus(payload.screenShareEnabled ? "sharing" : "idle")
      setScreenShareMessage(
        payload.screenShareEnabled ? "Screen sharing is active." : null
      )
      recordRealtimeKitDiagnostic("screen-share-update", {
        enabled: payload.screenShareEnabled,
      })
    }

    const handleMediaPermissionError = (payload: unknown): void => {
      recordRealtimeKitDiagnostic("media-permission-error", { payload })
      setAudioEnabled(meeting.self.audioEnabled)
      setVideoEnabled(meeting.self.videoEnabled)
      setAudioStatus("idle")
      setVideoStatus("idle")
      if (isRecord(payload) && recordValue(payload, "kind") === "screenshare") {
        setScreenShareStatus("blocked")
        setScreenShareMessage(
          "Screen sharing was blocked or canceled by the browser."
        )
      }
    }

    meeting.self.on("audioUpdate", handleAudioUpdate)
    meeting.self.on("videoUpdate", handleVideoUpdate)
    meeting.self.on("screenShareUpdate", handleScreenShareUpdate)
    meeting.self.on("mediaPermissionError", handleMediaPermissionError)
    setAudioEnabled(meeting.self.audioEnabled)
    setVideoEnabled(meeting.self.videoEnabled)
    setScreenShareStatus(
      meeting.self.screenShareEnabled ? "sharing" : "idle"
    )

    return () => {
      meeting.self.off("audioUpdate", handleAudioUpdate)
      meeting.self.off("videoUpdate", handleVideoUpdate)
      meeting.self.off("screenShareUpdate", handleScreenShareUpdate)
      meeting.self.off("mediaPermissionError", handleMediaPermissionError)
    }
  }, [meeting])

  React.useEffect(() => {
    if (!meeting || !transcriptEnabled) return
    const handleTranscript = (entry: TranscriptEntry): void => {
      setTranscripts((current) => mergeTranscript(current, entry))
    }
    meeting.ai.on("transcript", handleTranscript)
    setTranscripts([...meeting.ai.transcripts])
    return () => {
      meeting.ai.off("transcript", handleTranscript)
    }
  }, [meeting, transcriptEnabled])

  const savedTranscriptText = React.useMemo(
    () => transcriptText(transcripts),
    [transcripts]
  )

  const saveMeetingNotes = React.useCallback(async (): Promise<void> => {
    const trimmed = notes.trim()
    if (trimmed.length === 0) {
      setNotesStatus("Add a note before saving.")
      return
    }

    setNotesStatus("Saving notes...")
    const result = await sendMessage({
      channelId,
      content: `### Meeting notes\n\n${trimmed}`,
      contentHtml: `<section><h3>Meeting notes</h3><p>${linesToHtml(trimmed)}</p></section>`,
    })
    setNotesStatus(
      result.success
        ? "Saved to this conversation."
        : result.error ?? "Failed to save notes."
    )
  }, [channelId, notes])

  const saveTranscript = React.useCallback(async (): Promise<void> => {
    if (savedTranscriptText.length === 0) {
      setNotesStatus("No finalized transcript lines to save yet.")
      return
    }

    setNotesStatus("Saving transcript...")
    const result = await sendMessage({
      channelId,
      content: `### Meeting transcript\n\n${savedTranscriptText}`,
      contentHtml: `<section><h3>Meeting transcript</h3><pre>${escapeHtml(savedTranscriptText)}</pre></section>`,
    })
    setNotesStatus(
      result.success
        ? "Transcript saved to this conversation."
        : result.error ?? "Failed to save transcript."
    )
  }, [channelId, savedTranscriptText])

  const toggleTranscriptCapture = React.useCallback((): void => {
    setTranscriptEnabled((enabled) => {
      const nextEnabled = !enabled
      setNotesStatus(
        nextEnabled
          ? "Transcript capture started for this meeting."
          : "Transcript capture paused."
      )
      return nextEnabled
    })
  }, [])

  const openMeetingTool = React.useCallback(
    (selector: MeetingToolSelector, label: string): void => {
      const control = document.querySelector(
        `[data-compass-meeting] ${selector}`
      )
      if (control instanceof HTMLElement) {
        control.click()
        setScreenShareMessage(null)
        return
      }
      setScreenShareMessage(`${label} is not available in this meeting.`)
    },
    []
  )

  const toggleScreenShare = React.useCallback(async (): Promise<void> => {
    if (!meeting) return

    setScreenShareMessage(null)
    try {
      if (meeting.self.screenShareEnabled) {
        setScreenShareStatus("stopping")
        await meeting.self.disableScreenShare()
        setScreenShareStatus("idle")
        setScreenShareMessage(null)
        return
      }

      setScreenShareStatus("starting")
      await meeting.self.enableScreenShare()
      setScreenShareStatus(
        meeting.self.screenShareEnabled ? "sharing" : "idle"
      )
      setScreenShareMessage(
        meeting.self.screenShareEnabled
          ? "Screen sharing is active."
          : "Screen sharing did not start."
      )
    } catch (cause: unknown) {
      recordRealtimeKitDiagnostic("screen-share-failed", {
        error: realtimeKitErrorDetails(cause),
      })
      setScreenShareStatus("error")
      setScreenShareMessage(errorMessageForCause(cause))
    }
  }, [meeting])

  const toggleAudio = React.useCallback(async (): Promise<void> => {
    if (!meeting) return

    setScreenShareMessage(null)
    try {
      if (meeting.self.audioEnabled) {
        setAudioStatus("stopping")
        await meeting.self.disableAudio()
      } else {
        setAudioStatus("starting")
        await meeting.self.enableAudio()
      }
      setAudioEnabled(meeting.self.audioEnabled)
      setAudioStatus("idle")
    } catch (cause: unknown) {
      recordRealtimeKitDiagnostic("audio-toggle-failed", {
        error: realtimeKitErrorDetails(cause),
      })
      setAudioEnabled(meeting.self.audioEnabled)
      setAudioStatus("error")
      setScreenShareMessage(errorMessageForCause(cause))
    }
  }, [meeting])

  const toggleVideo = React.useCallback(async (): Promise<void> => {
    if (!meeting) return

    setScreenShareMessage(null)
    try {
      if (meeting.self.videoEnabled) {
        setVideoStatus("stopping")
        await meeting.self.disableVideo()
      } else {
        setVideoStatus("starting")
        await meeting.self.enableVideo()
      }
      setVideoEnabled(meeting.self.videoEnabled)
      setVideoStatus("idle")
    } catch (cause: unknown) {
      recordRealtimeKitDiagnostic("video-toggle-failed", {
        error: realtimeKitErrorDetails(cause),
      })
      setVideoEnabled(meeting.self.videoEnabled)
      setVideoStatus("error")
      setScreenShareMessage(errorMessageForCause(cause))
    }
  }, [meeting])

  const micButtonLabel =
    audioStatus === "starting"
      ? "Mic..."
      : audioStatus === "stopping"
        ? "Muting..."
        : audioEnabled
          ? "Mute"
          : "Mic"

  const videoButtonLabel =
    videoStatus === "starting"
      ? "Camera..."
      : videoStatus === "stopping"
        ? "Camera..."
        : videoEnabled
          ? "Stop Video"
          : "Video"

  const screenShareButtonLabel =
    screenShareStatus === "sharing"
      ? "Stop Sharing"
      : screenShareStatus === "starting"
        ? "Starting..."
        : screenShareStatus === "stopping"
          ? "Stopping..."
          : "Share Screen"
  const backgroundButtonLabel = backgroundStatus
    ? "Background Paused"
    : "Background"

  const showMeetingControls = !error

  return (
    <main
      data-compass-meeting
      className="fixed inset-0 z-[100] flex h-dvh min-h-dvh flex-col bg-slate-950 text-white"
    >
      <style>
        {`
          [data-compass-meeting] {
            --rtk-colors-text: 248 250 252;
            --rtk-colors-text-1000: 248 250 252;
            --rtk-colors-text-900: 226 232 240;
            --rtk-colors-text-800: 203 213 225;
            --rtk-colors-text-700: 148 163 184;
            --rtk-colors-text-600: 100 116 139;
            --rtk-colors-brand-300: 155 211 168;
            --rtk-colors-brand-400: 99 184 120;
            --rtk-colors-brand-500: 63 125 77;
            --rtk-colors-brand-600: 50 102 62;
            --rtk-colors-danger: 224 72 59;
            --rtk-colors-warning: 217 119 6;
            --rtk-colors-background-1000: 8 17 11;
            --rtk-colors-background-900: 14 26 18;
            --rtk-colors-background-800: 32 54 38;
            --rtk-colors-background-700: 45 74 52;
            --rtk-controlbar-button-background-color: rgba(248, 250, 252, 0.08);
            --rtk-controlbar-button-icon-size: 24px;
          }
          [data-compass-meeting] rtk-controlbar-button,
          [data-compass-meeting] rtk-mic-toggle,
          [data-compass-meeting] rtk-camera-toggle,
          [data-compass-meeting] rtk-screen-share-toggle,
          [data-compass-meeting] rtk-settings-toggle,
          [data-compass-meeting] rtk-more-toggle,
          [data-compass-meeting] rtk-chat-toggle,
          [data-compass-meeting] rtk-participants-toggle,
          [data-compass-meeting] rtk-polls-toggle,
          [data-compass-meeting] rtk-ai-toggle {
            color: #f8fafc;
          }
          [data-compass-meeting] rtk-ai-toggle,
          [data-compass-meeting] rtk-ai,
          [data-compass-meeting] rtk-ai-transcriptions,
          [data-compass-meeting] rtk-caption-toggle,
          [data-compass-meeting] rtk-transcripts {
            display: none !important;
          }
          [data-compass-meeting] rtk-controlbar-button {
            border-radius: 10px;
            filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.22));
          }
          [data-compass-meeting] rtk-controlbar-button::part(button) {
            border-color: rgba(155, 211, 168, 0.26);
            background: rgba(248, 250, 252, 0.08);
            color: #f8fafc;
          }
          [data-compass-meeting] rtk-controlbar-button::part(icon),
          [data-compass-meeting] rtk-controlbar-button::part(label) {
            color: #f8fafc;
          }
          [data-compass-meeting] rtk-controlbar-button:hover::part(button) {
            border-color: rgba(155, 211, 168, 0.62);
            background: rgba(63, 125, 77, 0.30);
            color: #ffffff;
          }
          [data-compass-meeting] rtk-controlbar-button.active::part(button),
          [data-compass-meeting] rtk-controlbar-button[brand-icon]::part(button) {
            border-color: #63b878;
            background: rgba(63, 125, 77, 0.38);
            color: #ffffff;
          }
          [data-compass-meeting] rtk-controlbar-button.red-icon::part(icon),
          [data-compass-meeting] rtk-controlbar-button.red-icon::part(label) {
            color: #ffd6d1;
          }
          [data-compass-meeting] rtk-leave-button rtk-controlbar-button::part(button),
          [data-compass-meeting] rtk-controlbar-button.leave::part(button) {
            border-color: rgba(224, 72, 59, 0.62);
            background: rgba(224, 72, 59, 0.18);
            color: #fff5f3;
          }
          [data-compass-meeting] rtk-leave-button rtk-controlbar-button:hover::part(button),
          [data-compass-meeting] rtk-controlbar-button.leave:hover::part(button) {
            border-color: #f87171;
            background: rgba(224, 72, 59, 0.36);
            color: #ffffff;
          }
        `}
      </style>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{meetingTitle}</h1>
          <p className="text-xs text-white/55">
            Compass meeting with notes, transcript, and background effects
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => window.close()}
            className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white"
          >
            Close Window
          </button>
        </div>
      </header>
      {screenShareMessage || backgroundStatus ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-white/70">
          {screenShareMessage ? <span>{screenShareMessage}</span> : null}
          {backgroundStatus ? <span>{backgroundStatus}</span> : null}
        </div>
      ) : null}
      <section className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto pb-28 xl:grid-cols-[minmax(0,1fr)_20rem] xl:overflow-hidden xl:pb-0">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-white/70 xl:col-span-2">
            Opening secure meeting...
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-200 xl:col-span-2">
            {error}
          </div>
        ) : (
          <div className="flex min-h-0 flex-col bg-black">
            <div className="relative min-h-0 flex-1">
              <RtkMeeting
                meeting={meeting}
                config={meetingConfig}
                applyDesignSystem
                leaveOnUnmount
                loadConfigFromPreset={false}
                showSetupScreen={false}
              />
            </div>
            {showMeetingControls ? (
              <div className="fixed inset-x-0 bottom-0 z-50 flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-white/10 bg-[#070b08]/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-16px_40px_rgba(0,0,0,0.38)] backdrop-blur xl:static xl:bg-[#070b08] xl:pb-3 xl:shadow-none xl:backdrop-blur-none">
                <button
                  type="button"
                  onClick={() => void toggleAudio()}
                  disabled={
                    !meeting ||
                    audioStatus === "starting" ||
                    audioStatus === "stopping"
                  }
                  className={`min-w-20 rounded-sm border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-70 ${
                    audioEnabled
                      ? "border-[#9bd3a8]/70 bg-[#3f7d4d] text-white hover:border-[#c1e5c9] hover:bg-[#4f9860]"
                      : "border-white/20 bg-white/[0.04] text-white hover:border-[#9bd3a8]/70 hover:bg-[#203626]"
                  }`}
                >
                  {micButtonLabel}
                </button>
                <button
                  type="button"
                  onClick={() => void toggleVideo()}
                  disabled={
                    !meeting ||
                    videoStatus === "starting" ||
                    videoStatus === "stopping"
                  }
                  className={`min-w-20 rounded-sm border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-70 ${
                    videoEnabled
                      ? "border-[#9bd3a8]/70 bg-[#3f7d4d] text-white hover:border-[#c1e5c9] hover:bg-[#4f9860]"
                      : "border-white/20 bg-white/[0.04] text-white hover:border-[#9bd3a8]/70 hover:bg-[#203626]"
                  }`}
                >
                  {videoButtonLabel}
                </button>
                {canScreenShare ? (
                  <button
                    type="button"
                    onClick={() => void toggleScreenShare()}
                    disabled={
                      !meeting ||
                      screenShareStatus === "starting" ||
                      screenShareStatus === "stopping"
                    }
                    className={`min-w-28 rounded-sm border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-70 ${
                      screenShareStatus === "sharing"
                        ? "border-red-300/70 bg-red-500/35 text-red-50 hover:bg-red-500/45"
                        : "border-[#9bd3a8]/70 bg-[#3f7d4d] text-white hover:border-[#c1e5c9] hover:bg-[#4f9860]"
                    }`}
                  >
                    {screenShareButtonLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    setBackgroundStatus(
                      backgroundStatus ??
                        "Background effects are paused while the video ML runtime is added."
                    )
                  }
                  className="min-w-28 rounded-sm border border-white/20 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white transition-colors hover:border-[#9bd3a8]/70 hover:bg-[#203626]"
                >
                  {backgroundButtonLabel}
                </button>
                <div className="mx-1 hidden h-8 w-px bg-white/15 sm:block" />
                <button
                  type="button"
                  onClick={() => openMeetingTool("rtk-chat-toggle", "Chat")}
                  className="min-w-16 rounded-sm border border-white/20 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white transition-colors hover:border-[#9bd3a8]/70 hover:bg-[#203626]"
                >
                  Chat
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openMeetingTool("rtk-participants-toggle", "People")
                  }
                  className="min-w-16 rounded-sm border border-white/20 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white transition-colors hover:border-[#9bd3a8]/70 hover:bg-[#203626]"
                >
                  People
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openMeetingTool("rtk-settings-toggle", "Settings")
                  }
                  className="min-w-20 rounded-sm border border-white/20 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white transition-colors hover:border-[#9bd3a8]/70 hover:bg-[#203626]"
                >
                  Settings
                </button>
              </div>
            ) : null}
          </div>
        )}
        {!loading && !error ? (
          <aside className="min-h-0 border-t border-white/10 bg-[#08110b] xl:border-l xl:border-t-0">
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 border-b border-white/10 p-2">
                <button
                  type="button"
                  onClick={() => setActivePanel("notes")}
                  className={`flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors ${
                    activePanel === "notes"
                      ? "bg-[#3f7d4d] text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  Notes
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel("transcript")}
                  className={`flex-1 rounded-sm px-3 py-2 text-sm font-medium transition-colors ${
                    activePanel === "transcript"
                      ? "bg-[#3f7d4d] text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  Transcript
                </button>
              </div>
              {activePanel === "notes" ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.currentTarget.value)}
                    placeholder="Meeting notes..."
                    className="min-h-0 flex-1 resize-none rounded-sm border border-white/15 bg-white/5 p-3 text-sm text-white outline-none transition-colors placeholder:text-white/35 focus:border-[#63b878]"
                  />
                  <button
                    type="button"
                    onClick={() => void saveMeetingNotes()}
                    className="rounded-sm bg-[#3f7d4d] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4f9860]"
                  >
                    Save Notes to Conversation
                  </button>
                  {notesStatus ? (
                    <p className="text-xs text-white/55">{notesStatus}</p>
                  ) : null}
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                    {!transcriptEnabled ? (
                      <div className="rounded-sm border border-white/10 bg-white/5 p-3 text-sm text-white/65">
                        <p className="font-semibold text-white">
                          Transcript capture is off.
                        </p>
                        <p className="mt-1">
                          Start it only after everyone knows the meeting is being
                          transcribed.
                        </p>
                      </div>
                    ) : null}
                    {transcripts.length === 0 ? (
                      <p className="rounded-sm border border-white/10 bg-white/5 p-3 text-sm text-white/60">
                        {transcriptEnabled
                          ? "No transcript lines yet."
                          : "No transcript has been captured for this meeting."}
                      </p>
                    ) : null}
                    {transcripts.length > 0
                      ? transcripts.map((entry) => (
                          <div
                            key={transcriptKey(entry)}
                            className={`rounded-sm border p-2 text-sm ${
                              entry.isPartialTranscript
                                ? "border-white/10 bg-white/5 text-white/55"
                                : "border-[#3f7d4d]/50 bg-[#3f7d4d]/10 text-white"
                            }`}
                          >
                            <div className="mb-1 flex items-center justify-between gap-2 text-xs text-white/45">
                              <span className="truncate font-medium">{entry.name}</span>
                              <span>
                                {entry.date.toLocaleTimeString([], {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                            <p>{entry.transcript}</p>
                          </div>
                        ))
                      : null}
                  </div>
                  <div className="grid shrink-0 gap-2 border-t border-white/10 p-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={toggleTranscriptCapture}
                      className={`rounded-sm px-3 py-2 text-sm font-semibold text-white transition-colors ${
                        transcriptEnabled
                          ? "border border-white/20 bg-white/10 hover:bg-white/15"
                          : "bg-[#3f7d4d] hover:bg-[#4f9860]"
                      }`}
                    >
                      {transcriptEnabled ? "Pause Transcript" : "Start Transcript"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveTranscript()}
                      disabled={savedTranscriptText.length === 0}
                      className="rounded-sm bg-[#3f7d4d] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4f9860] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
                    >
                      Save Transcript to Conversation
                    </button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </section>
    </main>
  )
}
