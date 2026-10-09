"use client"

import * as React from "react"
import {
  IconAntenna,
  IconPhoneOff,
  IconScreenShareOff,
  IconVideo,
  IconWaveSine,
  IconSparkles,
  IconMicrophoneOff,
  IconHeadphonesOff,
} from "@tabler/icons-react"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import { useVoiceState } from "@/hooks/use-voice-state"
import { cn } from "@/lib/utils"
import {
  ListeningRoomButton,
  ListeningRoomLauncher,
} from "@/components/voice/listening-room-button"
import { OFFICE_TALK_LISTENING_ROOM_CHANNEL_ID } from "@/lib/listening-room"

function RemoteVoiceAudio({
  stream,
}: {
  readonly stream: MediaStream
}): React.ReactElement {
  const audioRef = React.useRef<HTMLAudioElement | null>(null)

  React.useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.srcObject = stream
    void audio.play().catch(() => {
      // The browser may wait for a user gesture; the element stays ready.
    })
    return () => {
      audio.srcObject = null
    }
  }, [stream])

  return <audio ref={audioRef} autoPlay playsInline />
}

export function VoicePanel(): React.ReactElement {
  const {
    channelId,
    channelName,
    isNoiseSuppression,
    connectionStatus,
    connectionError,
    participants,
    remoteStreams,
    isRealtimeMeetingActive,
    toggleNoiseSuppression,
    leaveChannel,
    setRealtimeMeetingActive,
    suspendChannelAudio,
  } = useVoiceState()
  const meetingWindowRef = React.useRef<Window | null>(null)
  const meetingWindowPollRef = React.useRef<ReturnType<typeof setInterval> | null>(
    null
  )
  const participantCount = participants.length
  const statusLabel =
    isRealtimeMeetingActive
      ? "Video Meeting Open"
      : connectionStatus === "connecting"
      ? "Connecting Voice"
      : connectionStatus === "error"
        ? "Voice Needs Attention"
        : connectionStatus === "connected"
          ? "Voice Connected"
          : "Voice Paused"
  const statusColor =
    connectionStatus === "error" ? "text-destructive" : "text-success"

  const clearMeetingWindowPoll = React.useCallback((): void => {
    if (meetingWindowPollRef.current) {
      clearInterval(meetingWindowPollRef.current)
      meetingWindowPollRef.current = null
    }
  }, [])

  const openMeetingWindow = React.useCallback((): void => {
    if (!channelId) return
    const existing = meetingWindowRef.current
    if (existing && !existing.closed) {
      existing.focus()
      return
    }

    const url = `/dashboard/conversations/${channelId}/meeting`
    const meetingWindow = window.open(
      url,
      `compass-meeting-${channelId}`,
      "popup=yes,width=1180,height=760,noopener=no,noreferrer=no"
    )

    if (!meetingWindow) {
      window.open(url, "_blank", "noopener=no,noreferrer=no")
      return
    }

    meetingWindowRef.current = meetingWindow
    suspendChannelAudio()
    clearMeetingWindowPoll()
    meetingWindowPollRef.current = setInterval(() => {
      if (!meetingWindow.closed) return
      clearMeetingWindowPoll()
      meetingWindowRef.current = null
      setRealtimeMeetingActive(false)
    }, 1000)
    meetingWindow.focus()
  }, [
    channelId,
    clearMeetingWindowPoll,
    setRealtimeMeetingActive,
    suspendChannelAudio,
  ])

  React.useEffect(() => {
    return () => {
      clearMeetingWindowPoll()
      setRealtimeMeetingActive(false)
    }
  }, [clearMeetingWindowPoll, setRealtimeMeetingActive])

  return (
    <div className="group-data-[collapsible=icon]:hidden border-t border-sidebar-border">
      {/* Connection status and disconnect */}
      <div className="p-2">
        {!isRealtimeMeetingActive &&
          remoteStreams.map((remote) => (
            <RemoteVoiceAudio key={remote.userId} stream={remote.stream} />
          ))}
        <div className={cn("mb-1 flex items-center gap-1.5 text-xs", statusColor)}>
          <IconAntenna className="size-3.5" />
          <span className="font-medium">{statusLabel}</span>
        </div>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-sidebar-foreground/85">
            <span className="truncate">#{channelName}</span>
            <span className="shrink-0 text-sidebar-foreground/75">
              {participantCount} user{participantCount === 1 ? "" : "s"}
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={leaveChannel}
                className="flex size-6 items-center justify-center rounded-md border border-destructive/35 bg-destructive/10 text-destructive transition-colors hover:border-destructive/60 hover:bg-destructive/20 hover:text-destructive"
                aria-label="Disconnect"
              >
                <IconPhoneOff className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Disconnect</TooltipContent>
          </Tooltip>
        </div>
        {connectionError && (
          <div className="mb-2 rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {connectionError}
          </div>
        )}
        {participants.length > 0 && (
          <div className="mb-2 space-y-1">
            {participants.map((participant) => (
              <div
                key={participant.userId}
                className="flex items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-xs text-sidebar-foreground/85"
              >
                <span className="truncate">
                  {participant.displayName ?? "Compass user"}
                </span>
                <span className="flex items-center gap-1 text-sidebar-foreground/50">
                  {participant.isMuted && <IconMicrophoneOff className="size-3" />}
                  {participant.isDeafened && <IconHeadphonesOff className="size-3" />}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Toggle controls row */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled
                className="flex size-7 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/70 text-sidebar-foreground/75 opacity-70"
                aria-label="Screen share coming soon"
              >
                <IconScreenShareOff className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Screen Share (coming soon)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={openMeetingWindow}
                className="flex size-7 items-center justify-center rounded-md border border-call-accent-border/45 bg-call-accent text-white shadow-sm transition-colors hover:border-call-accent-border-strong hover:bg-call-accent-hover"
                aria-label="Open video meeting"
              >
                <IconVideo className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Video Meeting</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleNoiseSuppression}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/70 text-sidebar-foreground transition-colors hover:border-call-accent-border/60 hover:bg-call-accent-surface hover:text-white",
                  isNoiseSuppression && "border-call-accent-border/60 bg-call-accent-surface text-white"
                )}
                aria-label="Toggle noise suppression"
              >
                <IconWaveSine className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Noise Suppression</TooltipContent>
          </Tooltip>

          {channelId ? (
            channelId === OFFICE_TALK_LISTENING_ROOM_CHANNEL_ID ? (
              <ListeningRoomLauncher channelId={channelId} />
            ) : (
              <ListeningRoomButton
                channelId={channelId}
                channelName={channelName}
              />
            )
          ) : null}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled
                className="flex size-7 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/70 text-sidebar-foreground/75 opacity-70"
                aria-label="Activities (coming soon)"
              >
                <IconSparkles className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Activities (coming soon)</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
