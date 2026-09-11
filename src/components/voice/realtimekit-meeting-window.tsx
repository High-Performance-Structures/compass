"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { useRealtimeKitClient } from "@cloudflare/realtimekit-react"
import { RtkChatToggle, RtkParticipantsToggle, RtkMoreToggle, RtkPollsToggle, RtkFullscreenToggle, RtkMuteAllButton, RtkRecordingToggle } from "@cloudflare/realtimekit-react-ui"
import type { UIConfig } from "@cloudflare/realtimekit-react-ui"
import { joinRealtimeKitVoiceSession } from "@/app/actions/voice-sessions"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { createCompassMeetingConfig } from "@/components/voice/talk-meeting-config"
import { TalkMeetingRenderer } from "@/components/voice/talk-meeting-renderer"
import { TalkLeaveConfirmation } from "@/components/voice/talk-leave-confirmation"
import { TalkCallControls } from "@/components/voice/talk-call-controls"
import { CALL_NOTICE_INFO_MS, TalkCallNotice, type CallNotice, type CallNoticeAction } from "@/components/voice/talk-call-notice"
import { TalkSettingsPanel } from "@/components/voice/talk-settings-panel"
import { TalkSetup } from "@/components/voice/talk-setup"
import { TalkPreview } from "@/components/voice/talk-preview"
import { TalkNotesPanel } from "@/components/voice/talk-notes-panel"
import { useTalkSettings } from "@/hooks/use-talk-settings"
import { installRealtimeKitBrowserApiProxy } from "@/lib/realtimekit/browser-api-proxy"
import {
  createPictureInPictureTileRegistry,
  selectPictureInPictureVideo,
} from "@/lib/realtimekit/picture-in-picture"
import { useVoiceActivityPublisher } from "@/hooks/use-music-ducking"
import { useMutedSpeechHint } from "@/hooks/use-muted-speech-hint"

type ScreenShareStatus =
  | "idle"
  | "starting"
  | "sharing"
  | "stopping"
  | "blocked"
  | "error"

type MediaButtonStatus = "idle" | "starting" | "stopping" | "error"
type MeetingMediaKind = "audio" | "video"


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

const MAX_REALTIMEKIT_DIAGNOSTICS = 50

// Keep a bounded in-memory trail for support (window.__compassRealtimeKitDiagnostics).
// Serializing the whole history into the DOM on every media event slowed long calls.
function recordRealtimeKitDiagnostic(
  event: string,
  payload: Readonly<Record<string, unknown>>
): void {
  if (typeof window !== "undefined") {
    const existing = Reflect.get(window, "__compassRealtimeKitDiagnostics")
    const diagnostics = Array.isArray(existing) ? existing : []
    const nextDiagnostics = [
      ...diagnostics,
      { event, at: new Date().toISOString(), payload },
    ].slice(-MAX_REALTIMEKIT_DIAGNOSTICS)
    Reflect.set(window, "__compassRealtimeKitDiagnostics", nextDiagnostics)
  }
  console.info(`RealtimeKit diagnostic: ${event}`, payload)
}

function mediaDeviceLabel(kind: MeetingMediaKind): string {
  return kind === "audio" ? "microphone" : "camera"
}

function mediaPermissionMessage(
  kind: MeetingMediaKind,
  cause: unknown
): string {
  const label = mediaDeviceLabel(kind)
  if (cause instanceof DOMException || cause instanceof Error) {
    if (cause.name === "NotFoundError") {
      return `No ${label} was found. Connect one, choose System default in Background & Settings, and try again.`
    }
    if (cause.name === "NotReadableError" || cause.name === "AbortError") {
      return `The ${label} is unavailable or already in use by another app. Close the other app and try again.`
    }
    if (cause.name === "NotAllowedError" || cause.name === "SecurityError") {
      return `Compass cannot access your ${label}. Allow it in this site’s browser permissions and your system privacy settings, then try again. If you just changed system access, fully quit and reopen the browser.`
    }
  }

  return `Office Talk could not start your ${label}. Check the selected device and browser permissions, then try again.`
}

async function requestMediaTrack(
  kind: MeetingMediaKind,
  deviceId: string
): Promise<MediaStreamTrack> {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.mediaDevices?.getUserMedia !== "function"
  ) {
    throw new Error("This browser does not support camera or microphone access.")
  }

  const available = await navigator.mediaDevices.enumerateDevices()
  const selected = available.some(device => device.deviceId === deviceId && device.kind === (kind === "audio" ? "audioinput" : "videoinput"))
  const constraints = selected ? { deviceId: { exact: deviceId } } : true
  const stream = await navigator.mediaDevices.getUserMedia(
    kind === "audio" ? { audio: constraints, video: false } : { audio: false, video: constraints }
  )
  const tracks =
    kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks()
  const track = tracks[0]
  if (!track) {
    for (const streamTrack of stream.getTracks()) streamTrack.stop()
    throw new Error(`No ${mediaDeviceLabel(kind)} track was returned.`)
  }

  for (const streamTrack of stream.getTracks()) {
    if (streamTrack !== track) streamTrack.stop()
  }
  return track
}

export function RealtimeKitMeetingWindow({
  channelId,
  userId,
}: {
  readonly channelId: string
  readonly userId: string
}): React.ReactElement {
  const [meeting, initMeeting] = useRealtimeKitClient({ resetOnLeave: true })
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [meetingTitle, setMeetingTitle] = React.useState("Compass Talk")
  const [meetingConfig] = React.useState<UIConfig>(() =>
    createCompassMeetingConfig()
  )
  const [notesPanelOpen, setNotesPanelOpenState] = React.useState(true)
  const [hasUnsavedNotes, setHasUnsavedNotes] = React.useState(false)
  const [transcriptEnabled, setTranscriptEnabled] = React.useState(false)
  const [screenShareStatus, setScreenShareStatus] =
    React.useState<ScreenShareStatus>("idle")
  const [notice, setNotice] = React.useState<CallNotice | null>(null)
  const [audioEnabled, setAudioEnabled] = React.useState(false)
  const [videoEnabled, setVideoEnabled] = React.useState(false)
  const [audioStatus, setAudioStatus] =
    React.useState<MediaButtonStatus>("idle")
  const [videoStatus, setVideoStatus] =
    React.useState<MediaButtonStatus>("idle")
  const [pipStatus, setPipStatus] =
    React.useState<MediaButtonStatus>("idle")
  const [joined, setJoined] = React.useState(false)
  const [joining, setJoining] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [leaveOpen, setLeaveOpen] = React.useState(false)
  const [leaving, setLeaving] = React.useState(false)
  const [leaveError, setLeaveError] = React.useState<string | null>(null)
  const [canEndMeeting, setCanEndMeeting] = React.useState(false)
  const talk = useTalkSettings(meeting, userId)
  const [canScreenShare, setCanScreenShare] = React.useState(false)
  const [canUsePictureInPicture, setCanUsePictureInPicture] =
    React.useState(false)
  const [pictureInPictureActive, setPictureInPictureActive] =
    React.useState(false)
  const audioTrackRef = React.useRef<MediaStreamTrack | null>(null)
  const videoTrackRef = React.useRef<MediaStreamTrack | null>(null)
  const meetingUiRef = React.useRef<HTMLDivElement | null>(null)
  const pipTileRegistryRef = React.useRef(createPictureInPictureTileRegistry())
  const endingMeetingRef = React.useRef(false)

  const showInfo = React.useCallback((text: string): void => {
    setNotice({ tone: "info", text, action: null })
  }, [])
  const showError = React.useCallback(
    (text: string, action: CallNoticeAction | null = null): void => {
      setNotice({ tone: "error", text, action })
    },
    []
  )
  // Routine status clears itself; errors stay until dismissed or replaced.
  React.useEffect(() => {
    if (notice?.tone !== "info") return
    const timer = window.setTimeout(() => {
      setNotice((current) => (current === notice ? null : current))
    }, CALL_NOTICE_INFO_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  // Remember whether each person keeps Notes & Transcript open. New users start
  // collapsed below the xl breakpoint so the video keeps the room.
  const notesPanelKey = `compass:talk:notes-panel:v1:${userId}`
  React.useEffect(() => {
    let stored: string | null = null
    try {
      stored = localStorage.getItem(notesPanelKey)
    } catch {
      /* Storage unavailable: fall back to the window size. */
    }
    setNotesPanelOpenState(
      stored === "open" ||
        (stored === null &&
          (typeof window.matchMedia !== "function" ||
            window.matchMedia("(min-width: 1280px)").matches))
    )
  }, [notesPanelKey])
  const setNotesPanelOpen = React.useCallback(
    (open: boolean): void => {
      setNotesPanelOpenState(open)
      try {
        localStorage.setItem(notesPanelKey, open ? "open" : "closed")
      } catch {
        /* The choice still applies to this call. */
      }
    },
    [notesPanelKey]
  )

  const getVoiceTracks = React.useCallback((): readonly MediaStreamTrack[] => {
    if (!meeting) return []
    const tracks: MediaStreamTrack[] = []
    if (meeting.self.audioEnabled) tracks.push(meeting.self.audioTrack)
    for (const participant of meeting.participants.audioSubscribed.values()) {
      if (participant.audioEnabled) tracks.push(participant.audioTrack)
    }
    return tracks
  }, [meeting])
  useVoiceActivityPublisher({
    channelId: meeting && joined ? channelId : null,
    getTracks: getVoiceTracks,
  })

  React.useEffect(() => {
    if (!meeting) return
    return () => { if (!meeting.self.roomJoined) meeting.self.cleanUpTracks() }
  }, [meeting])

  const setRealtimeKitCaptions = React.useCallback((enabled: boolean): void => {
    const meetingElement =
      meetingUiRef.current?.querySelector<HTMLElement>("rtk-meeting")
    meetingElement?.dispatchEvent(
      new CustomEvent("rtkStateUpdate", {
        detail: { activeCaptions: enabled },
        bubbles: true,
        composed: true,
      })
    )
    setTranscriptEnabled(enabled)
  }, [])

  React.useEffect(() => {
    setCanScreenShare(
      typeof navigator !== "undefined" &&
        typeof navigator.mediaDevices?.getDisplayMedia === "function"
    )
  }, [])

  React.useEffect(() => {
    if (!meeting) return
    const updatePictureInPictureState = (): void => {
      setPictureInPictureActive(Boolean(document.pictureInPictureElement))
    }
    const updatePermissions = (): void => {
      setCanEndMeeting(meeting.self.permissions.kickParticipant)
    }
    const updateCapability = (): void => {
      setCanUsePictureInPicture(
        Boolean(document.pictureInPictureEnabled) && meeting.self.config.pipMode
      )
    }
    updatePictureInPictureState()
    updateCapability()
    updatePermissions()
    // Browser PiP events do not reliably bubble from videos inside SDK shadow roots.
    document.addEventListener("enterpictureinpicture", updatePictureInPictureState, true)
    document.addEventListener("leavepictureinpicture", updatePictureInPictureState, true)
    meeting.self.permissions.addListener("permissionsUpdate", updatePermissions)
    return () => {
      document.removeEventListener("enterpictureinpicture", updatePictureInPictureState, true)
      document.removeEventListener("leavepictureinpicture", updatePictureInPictureState, true)
      meeting.self.permissions.removeListener("permissionsUpdate", updatePermissions)
    }
  }, [meeting])

  React.useEffect(() => {
    return () => {
      audioTrackRef.current?.stop()
      videoTrackRef.current?.stop()
      audioTrackRef.current = null
      videoTrackRef.current = null
    }
  }, [])

  React.useEffect(() => {
    if (!meeting || loading || error) return
    const meetingUi = meetingUiRef.current
    if (!meetingUi) return

    return pipTileRegistryRef.current.attach(meetingUi)
  }, [error, loading, meeting])

  React.useEffect(() => {
    if (!meeting || loading || error) return
    const meetingUi = meetingUiRef.current
    if (!meetingUi) return

    return pipTileRegistryRef.current.attach(meetingUi)
  }, [error, loading, meeting])

  React.useEffect(() => {
    if (!meeting || loading || error) return
    const meetingElement =
      meetingUiRef.current?.querySelector<HTMLElement>("rtk-meeting")
    if (!meetingElement) return

    const handleStatesUpdate = (event: Event): void => {
      if (!(event instanceof CustomEvent) || !isRecord(event.detail)) return
      const activeCaptions = recordValue(event.detail, "activeCaptions")
      if (typeof activeCaptions === "boolean") {
        setTranscriptEnabled(activeCaptions)
      }
    }

    meetingElement.addEventListener("rtkStatesUpdate", handleStatesUpdate)
    // RealtimeKit 2 defaults captions on whenever the preset permits
    // transcription. Compass requires an explicit per-participant opt-in.
    const frame = window.requestAnimationFrame(() => {
      setRealtimeKitCaptions(false)
    })

    return () => {
      window.cancelAnimationFrame(frame)
      meetingElement.removeEventListener("rtkStatesUpdate", handleStatesUpdate)
    }
  }, [error, loading, meeting, setRealtimeKitCaptions])

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
      setJoined(initializedMeeting.self.roomJoined)
    }

    void (async () => {
      try {
        await openMeeting(false)
      } catch (firstCause: unknown) {
        if (!isCurrent) return
        try {
          await openMeeting(false)
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

    const handleAudioUpdate = (payload: {
      readonly audioEnabled: boolean
    }): void => {
      if (!payload.audioEnabled) {
        audioTrackRef.current?.stop()
        audioTrackRef.current = null
      }
      setAudioEnabled(payload.audioEnabled)
      setAudioStatus("idle")
      recordRealtimeKitDiagnostic("audio-update", {
        enabled: payload.audioEnabled,
      })
    }

    const handleVideoUpdate = (payload: {
      readonly videoEnabled: boolean
    }): void => {
      if (!payload.videoEnabled) {
        videoTrackRef.current?.stop()
        videoTrackRef.current = null
      }
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
      if (payload.screenShareEnabled) showInfo("Screen sharing is active.")
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
      const kind = isRecord(payload) ? recordValue(payload, "kind") : null
      if (kind === "audio" || kind === "video") {
        showError(mediaPermissionMessage(kind, payload), kind === "audio" ? "retry-audio" : "retry-video")
      } else if (kind === "screenshare") {
        setScreenShareStatus("blocked")
        showInfo("Screen sharing was blocked or canceled by the browser.")
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
  }, [meeting, showError, showInfo])

  const closeMeetingWindow = React.useCallback((): void => {
    window.close()
    window.setTimeout(() => {
      window.location.assign(`/dashboard/conversations/${channelId}`)
    }, 150)
  }, [channelId])

  React.useEffect(() => {
    if (!meeting) return
    const handleRoomLeft = (): void => {
      if (!endingMeetingRef.current) return
      endingMeetingRef.current = false
      closeMeetingWindow()
    }
    meeting.self.on("roomLeft", handleRoomLeft)
    return () => { meeting.self.off("roomLeft", handleRoomLeft) }
  }, [meeting, closeMeetingWindow])

  const leaveMeeting = React.useCallback(async (endForEveryone: boolean): Promise<void> => {
    if (!meeting || leaving) return
    // Use the SDK's host permission and server-authorized kickAll operation,
    // matching its built-in End for Everyone choice. Recheck at confirmation.
    if (endForEveryone && !meeting.self.permissions.kickParticipant) {
      setLeaveError("You do not have permission to end this meeting for everyone.")
      return
    }
    setLeaving(true)
    setLeaveError(null)
    try {
      if (endForEveryone) {
        // kickAll sends a request without a server acknowledgement. Keep the
        // connection alive until roomLeft confirms that the host was removed.
        endingMeetingRef.current = true
        await meeting.participants.kickAll()
        showInfo("Ending the meeting for everyone...")
      } else {
        if (meeting.self.roomJoined) await meeting.leave()
        closeMeetingWindow()
      }
      setLeaveOpen(false)
    } catch (cause: unknown) {
      recordRealtimeKitDiagnostic("leave-meeting-failed", {
        error: realtimeKitErrorDetails(cause),
      })
      endingMeetingRef.current = false
      setLeaveError(errorMessageForCause(cause))
    } finally {
      setLeaving(false)
    }
  }, [closeMeetingWindow, meeting, leaving, showInfo])

  const togglePictureInPicture = React.useCallback(async (): Promise<void> => {
    if (!meeting || !canUsePictureInPicture) {
      showError("Picture-in-picture is not available in this browser.")
      return
    }
    setNotice(null)
    try {
      if (document.pictureInPictureElement) {
        setPipStatus("stopping")
        await document.exitPictureInPicture()
        setPictureInPictureActive(false)
        setPipStatus("idle")
        return
      }

      const activeVideo = selectPictureInPictureVideo(
        pipTileRegistryRef.current.getCandidates(meeting.self.id)
      )
      if (!activeVideo) {
        showError("Turn video on before starting picture-in-picture.")
        return
      }

      setPipStatus("starting")
      await activeVideo.requestPictureInPicture()
      setPictureInPictureActive(true)
      setPipStatus("idle")
    } catch (cause: unknown) {
      recordRealtimeKitDiagnostic("picture-in-picture-failed", {
        error: realtimeKitErrorDetails(cause),
      })
      setPipStatus("error")
      showError(errorMessageForCause(cause))
    }
  }, [canUsePictureInPicture, meeting, showError])

  const toggleScreenShare = React.useCallback(async (): Promise<void> => {
    if (!meeting) return

    setNotice(null)
    try {
      if (meeting.self.screenShareEnabled) {
        setScreenShareStatus("stopping")
        await meeting.self.disableScreenShare()
        setScreenShareStatus("idle")
        setNotice(null)
        return
      }

      setScreenShareStatus("starting")
      await meeting.self.enableScreenShare()
      setScreenShareStatus(
        meeting.self.screenShareEnabled ? "sharing" : "idle"
      )
      if (meeting.self.screenShareEnabled) showInfo("Screen sharing is active.")
      else showError("Screen sharing did not start.", "retry-screen-share")
    } catch (cause: unknown) {
      recordRealtimeKitDiagnostic("screen-share-failed", {
        error: realtimeKitErrorDetails(cause),
      })
      setScreenShareStatus("error")
      showError(errorMessageForCause(cause), "retry-screen-share")
    }
  }, [meeting, showError, showInfo])

  /** Let the SDK open the selected microphone itself (the path PiP uses). */
  const enableAudioWithSdkCapture = React.useCallback(async (): Promise<MediaStreamTrack> => {
    if (!meeting) throw new Error("The meeting is not ready.")
    const available = await navigator.mediaDevices.enumerateDevices()
    const selected = available.find(device =>
      device.kind === "audioinput" && device.deviceId === talk.preferences.microphoneId
    )
    if (selected) await meeting.self.setDevice(selected)
    await meeting.self.enableAudio()
    if (!meeting.self.audioEnabled) {
      meeting.self.rawAudioTrack?.stop()
      throw new Error("RealtimeKit did not enable the microphone track.")
    }
    await talk.refreshDevices()
    return meeting.self.rawAudioTrack
  }, [meeting, talk])

  const toggleAudio = React.useCallback(async (): Promise<void> => {
    if (!meeting) return

    setNotice(null)
    let requestedTrack: MediaStreamTrack | null = null
    let microphoneFound = false
    try {
      if (meeting.self.audioEnabled) {
        setAudioStatus("stopping")
        await meeting.self.disableAudio()
        audioTrackRef.current?.stop()
        audioTrackRef.current = null
      } else {
        setAudioStatus("starting")
        // The SDK silently returns when a participant cannot publish audio.
        // Explain meeting permission separately from browser/device access.
        if (
          meeting.self.permissions.canProduceAudio === "NOT_ALLOWED" ||
          (meeting.self.permissions.canProduceAudio === "CAN_REQUEST" &&
            (meeting.self.stageStatus === "OFF_STAGE" || meeting.self.stageStatus === "REQUESTED_TO_JOIN_STAGE"))
        ) {
          setAudioStatus("error")
          showError("This meeting does not currently allow your microphone. Ask the host to allow you to speak.")
          return
        }
        requestedTrack = await requestMediaTrack("audio", talk.preferences.microphoneId)
        microphoneFound = true
        await talk.refreshDevices()
        await meeting.self.enableAudio(requestedTrack)
        if (!meeting.self.audioEnabled) {
          // PiP uses SDK-owned capture. If a fresh application track cannot
          // start audio, retry that same supported path without requiring PiP.
          await meeting.self.disableAudio()
          requestedTrack.stop()
          requestedTrack = null
          requestedTrack = await enableAudioWithSdkCapture()
          recordRealtimeKitDiagnostic("audio-sdk-capture-recovered", {})
        }
        audioTrackRef.current?.stop()
        audioTrackRef.current = requestedTrack
        requestedTrack = null
      }
      setAudioEnabled(meeting.self.audioEnabled)
      setAudioStatus("idle")
    } catch (cause: unknown) {
      requestedTrack?.stop()
      recordRealtimeKitDiagnostic("audio-toggle-failed", {
        error: realtimeKitErrorDetails(cause),
        microphoneFound,
        canProduceAudio: meeting.self.permissions.canProduceAudio,
        stageStatus: meeting.self.stageStatus,
      })
      setAudioEnabled(meeting.self.audioEnabled)
      setAudioStatus("error")
      if (microphoneFound) {
        showError("Your browser found a microphone, but Office Talk could not turn it on.", "alternate-microphone")
      } else {
        showError(mediaPermissionMessage("audio", cause), "retry-audio")
      }
    }
  }, [enableAudioWithSdkCapture, meeting, showError, talk])

  // The method the SDK's PiP controls use; offered when the normal path fails.
  const tryAlternateMicrophone = React.useCallback(async (): Promise<void> => {
    if (!meeting) return
    setNotice(null)
    setAudioStatus("starting")
    try {
      if (!meeting.self.audioEnabled) {
        const track = await enableAudioWithSdkCapture()
        audioTrackRef.current?.stop()
        audioTrackRef.current = track
      }
      recordRealtimeKitDiagnostic("audio-alternate-capture", { enabled: meeting.self.audioEnabled })
      setAudioEnabled(meeting.self.audioEnabled)
      setAudioStatus("idle")
    } catch (cause: unknown) {
      recordRealtimeKitDiagnostic("audio-alternate-capture-failed", {
        error: realtimeKitErrorDetails(cause),
      })
      setAudioEnabled(meeting.self.audioEnabled)
      setAudioStatus("error")
      showError(
        "The alternate method also could not turn on your microphone. Close other apps that may be using it, or open PiP and use its microphone button.",
        "retry-audio"
      )
    }
  }, [enableAudioWithSdkCapture, meeting, showError])

  const toggleVideo = React.useCallback(async (): Promise<void> => {
    if (!meeting) return

    setNotice(null)
    let requestedTrack: MediaStreamTrack | null = null
    try {
      if (meeting.self.videoEnabled) {
        setVideoStatus("stopping")
        await meeting.self.disableVideo()
        videoTrackRef.current?.stop()
        videoTrackRef.current = null
      } else {
        setVideoStatus("starting")
        if (!await talk.applyBackground()) { setVideoStatus("idle"); return }
        requestedTrack = await requestMediaTrack("video", talk.preferences.cameraId)
        await meeting.self.enableVideo(requestedTrack)
        if (!meeting.self.videoEnabled || (talk.preferences.background.mode !== "none" && meeting.self.videoTrack === meeting.self.rawVideoTrack)) {
          requestedTrack.stop()
          requestedTrack = null
          await meeting.self.disableVideo()
          throw new Error("The camera background could not start. Choose Off or join without video.")
        }
        videoTrackRef.current?.stop()
        videoTrackRef.current = requestedTrack
        requestedTrack = null
      }
      setVideoEnabled(meeting.self.videoEnabled)
      setVideoStatus("idle")
    } catch (cause: unknown) {
      requestedTrack?.stop()
      recordRealtimeKitDiagnostic("video-toggle-failed", {
        error: realtimeKitErrorDetails(cause),
      })
      setVideoEnabled(meeting.self.videoEnabled)
      setVideoStatus("error")
      showError(cause instanceof Error && cause.message.includes("background") ? cause.message : mediaPermissionMessage("video", cause), "retry-video")
    }
  }, [meeting, showError, talk])

  const handleNoticeAction = (action: CallNoticeAction): void => {
    if (action === "alternate-microphone") void tryAlternateMicrophone()
    else if (action === "retry-audio" || action === "unmute") {
      if (!meeting?.self.audioEnabled) void toggleAudio()
    } else if (action === "retry-video") {
      if (!meeting?.self.videoEnabled) void toggleVideo()
    } else void toggleScreenShare()
  }

  useMutedSpeechHint({
    active: joined && talk.preferences.mutedSpeechHint && !audioEnabled && audioStatus === "idle",
    microphoneId: talk.preferences.microphoneId,
    onSpeech: () => {
      // Never cover an error the person still needs to act on.
      setNotice((current) =>
        current?.tone === "error"
          ? current
          : { tone: "info", text: "You're muted. Unmute to talk.", action: "unmute" }
      )
    },
  })

  const micButtonLabel =
    audioStatus === "starting"
      ? "Unmuting..."
      : audioStatus === "stopping"
        ? "Muting..."
        : audioEnabled
          ? "Mute"
          : "Unmute"

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

  const pipButtonLabel =
    pipStatus === "starting"
      ? "PiP..."
      : pipStatus === "stopping"
        ? "Closing..."
        : pictureInPictureActive
          ? "Exit PiP"
          : "PiP"

  const joinPreparedMeeting = async (): Promise<void> => {
    if (!meeting || joining || talk.busy) return
    setJoining(true)
    setNotice(null)
    try {
      await talk.restoreDevices()
      if (talk.preferences.joinWithCamera && !meeting.self.videoEnabled) {
        await toggleVideo()
        if (!meeting.self.videoEnabled) return
      } else if (!talk.preferences.joinWithCamera && meeting.self.videoEnabled) {
        await toggleVideo()
      }
      if (talk.preferences.joinWithMicrophone && !meeting.self.audioEnabled) {
        await toggleAudio()
        if (!meeting.self.audioEnabled) return
      } else if (!talk.preferences.joinWithMicrophone && meeting.self.audioEnabled) {
        await toggleAudio()
      }
      await meeting.join()
      setJoined(true)
    } catch (cause: unknown) {
      showError(errorMessageForCause(cause))
    } finally { setJoining(false) }
  }

  const settingsPanel = (
    <TalkSettingsPanel preferences={talk.preferences} onChange={talk.update} devices={talk.devices}
      onDeviceChange={(kind, id) => void talk.changeDevice(kind, id)}
      onRefreshDevices={() => void talk.refreshDevices()} busy={talk.busy || joining} status={talk.status} />
  )

  if (!loading && !error && meeting && !joined) {
    const mediaBusy = videoStatus === "starting" || videoStatus === "stopping" || audioStatus === "starting" || audioStatus === "stopping"
    return <TalkSetup title={meetingTitle}
      preview={<TalkPreview meeting={meeting} videoEnabled={videoEnabled} audioEnabled={audioEnabled} speakerId={talk.preferences.speakerId} />}
      settings={settingsPanel} videoEnabled={videoEnabled} audioEnabled={audioEnabled}
      busy={talk.busy || joining || mediaBusy} canJoin={talk.ready} joining={joining} error={notice?.tone === "error" ? notice.text : null}
      onVideo={() => void toggleVideo()} onAudio={() => void toggleAudio()} onJoin={() => void joinPreparedMeeting()}
      onCancel={() => { meeting.self.cleanUpTracks(); window.location.assign(`/dashboard/conversations/${channelId}`) }} />
  }

  return (
    <main
      data-compass-meeting
      className="dark fixed inset-0 z-[100] flex h-dvh min-h-dvh flex-col bg-background text-foreground"
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
          [data-compass-meeting] rtk-caption-toggle,
          [data-compass-meeting] rtk-ai-toggle {
            color: #f8fafc;
          }
          [data-compass-meeting] rtk-ai-toggle,
          [data-compass-meeting] rtk-ai,
          [data-compass-meeting] rtk-ai-transcriptions,
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
      {talk.status ? (
        <p role="status" className="shrink-0 border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
          {talk.status}
        </p>
      ) : null}
      <TalkLeaveConfirmation open={leaveOpen} busy={leaving} error={leaveError}
        canEndMeeting={canEndMeeting} hasUnsavedNotes={hasUnsavedNotes}
        onOpenChange={setLeaveOpen}
        onLeave={() => void leaveMeeting(false)}
        onEndMeeting={() => void leaveMeeting(true)} />
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="z-[130] max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Camera & Background</DialogTitle><DialogDescription>Update your background and devices without leaving the call.</DialogDescription></DialogHeader>
          {meeting ? <TalkPreview meeting={meeting} videoEnabled={videoEnabled} audioEnabled={audioEnabled} speakerId={talk.preferences.speakerId} /> : null}
          {settingsPanel}
        </DialogContent>
      </Dialog>
      <section className={cn(
        "grid min-h-0 flex-1 overflow-hidden",
        notesPanelOpen
          ? "grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,min(16rem,32dvh))] xl:grid-cols-[minmax(0,1fr)_20rem] xl:grid-rows-1"
          : "grid-cols-1 grid-rows-1"
      )}>
        {loading ? (
          <div className="row-span-2 flex h-full items-center justify-center text-sm text-white/70 xl:col-span-2">
            Opening secure meeting...
          </div>
        ) : error ? (
          <div className="row-span-2 flex h-full items-center justify-center px-6 text-center text-sm text-red-200 xl:col-span-2">
            {error}
          </div>
        ) : (
          <div ref={meetingUiRef} className="relative min-h-0 min-w-0 overflow-hidden bg-black">
            <div className="h-full w-full">
              {/* Fill keeps the SDK renderer inside its grid cell, leaving the call controls clickable. */}
              <TalkMeetingRenderer meeting={meeting} config={meetingConfig}>
                <TalkCallControls
                  audioEnabled={audioEnabled} audioLabel={micButtonLabel}
                  audioDisabled={!meeting || audioStatus === "starting" || audioStatus === "stopping"}
                  onAudio={() => void toggleAudio()}
                  videoEnabled={videoEnabled} videoLabel={videoButtonLabel}
                  videoDisabled={!meeting || talk.busy || videoStatus === "starting" || videoStatus === "stopping"}
                  onVideo={() => void toggleVideo()}
                  canScreenShare={canScreenShare} screenShareLabel={screenShareButtonLabel}
                  screenShareDisabled={!meeting || screenShareStatus === "starting" || screenShareStatus === "stopping"}
                  onScreenShare={() => void toggleScreenShare()}
                  pipLabel={pipButtonLabel}
                  pipDisabled={!meeting || !canUsePictureInPicture || pipStatus === "starting" || pipStatus === "stopping"}
                  onPip={() => void togglePictureInPicture()}
                  onSettings={() => setSettingsOpen(true)}
                  leaveDisabled={!meeting || leaving} onLeave={() => { setLeaveError(null); setLeaveOpen(true) }}
                  notesPanelOpen={notesPanelOpen}
                  onToggleNotesPanel={() => setNotesPanelOpen(!notesPanelOpen)}
                  notice={notice ? (
                    <TalkCallNotice notice={notice} onAction={handleNoticeAction} onDismiss={() => setNotice(null)} />
                  ) : null}
                >
                  <RtkChatToggle meeting={meeting} variant="horizontal" />
                  <RtkParticipantsToggle meeting={meeting} variant="horizontal" />
                  <RtkMoreToggle>
                    <RtkPollsToggle slot="more-elements" variant="horizontal" />
                    <RtkFullscreenToggle slot="more-elements" variant="horizontal" targetElement={meetingUiRef.current ?? undefined} />
                    {/* Host-only meeting controls; Plugins, Breakout Rooms, and Debugger are not offered to staff. */}
                    {canEndMeeting ? <RtkMuteAllButton slot="more-elements" variant="horizontal" /> : null}
                    {canEndMeeting ? <RtkRecordingToggle slot="more-elements" variant="horizontal" /> : null}
                  </RtkMoreToggle>
                </TalkCallControls>
              </TalkMeetingRenderer>
            </div>
          </div>
        )}
        {!loading && !error && meeting ? (
          <TalkNotesPanel meeting={meeting} channelId={channelId} userId={userId}
            open={notesPanelOpen} onClose={() => setNotesPanelOpen(false)}
            transcriptEnabled={transcriptEnabled} onTranscriptEnabledChange={setRealtimeKitCaptions}
            onUnsavedNotesChange={setHasUnsavedNotes} />
        ) : null}
      </section>
    </main>
  )
}
