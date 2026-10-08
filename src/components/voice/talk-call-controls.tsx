"use client"

import type { ReactNode } from "react"
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  PictureInPicture2,
  Settings,
  PhoneOff,
  PanelRightClose,
  PanelRightOpen
} from "lucide-react"
import { Button } from "@/components/ui/button"

type TalkCallControlsProps = {
  readonly audioEnabled: boolean
  readonly audioLabel: string
  readonly audioDisabled: boolean
  readonly onAudio: () => void
  readonly videoEnabled: boolean
  readonly videoLabel: string
  readonly videoDisabled: boolean
  readonly onVideo: () => void
  readonly canScreenShare: boolean
  readonly screenShareLabel: string
  readonly screenShareDisabled: boolean
  readonly onScreenShare: () => void
  readonly pipLabel: string
  readonly pipDisabled: boolean
  readonly onPip: () => void
  readonly onSettings: () => void
  readonly leaveDisabled: boolean
  readonly onLeave: () => void
  readonly notesPanelOpen: boolean
  readonly onToggleNotesPanel: () => void
  /** Rendered directly above the controls so errors appear next to the button that failed. */
  readonly notice: ReactNode
  readonly children: ReactNode
}

export function TalkCallControls(props: TalkCallControlsProps): ReactNode {
  return (
    <div slot="compass-controls" className="flex w-full flex-col bg-background text-foreground">
    {props.notice}
    <div
      role="toolbar"
      aria-label="Call controls"
      className="flex w-full flex-wrap items-center gap-2 p-2 [&_button]:h-9 [&_button]:shrink-0 [&_button]:whitespace-nowrap [&_button]:px-2 [&_button]:text-xs"
    >
      <Button
        type="button"
        variant={props.audioEnabled ? "secondary" : "outline"}
        aria-label={
          props.audioEnabled ? "Mute microphone" : "Unmute microphone"
        }
        disabled={props.audioDisabled}
        onClick={props.onAudio}
      >
        {props.audioEnabled ? (
          <Mic aria-hidden="true" />
        ) : (
          <MicOff aria-hidden="true" />
        )}
        {props.audioLabel}
      </Button>
      <Button
        type="button"
        variant={props.videoEnabled ? "secondary" : "outline"}
        disabled={props.videoDisabled}
        onClick={props.onVideo}
      >
        {props.videoEnabled ? (
          <Video aria-hidden="true" />
        ) : (
          <VideoOff aria-hidden="true" />
        )}
        {props.videoLabel}
      </Button>
      {props.canScreenShare ? (
        <Button
          type="button"
          variant="outline"
          aria-label={props.screenShareLabel}
          disabled={props.screenShareDisabled}
          onClick={props.onScreenShare}
        >
          <MonitorUp aria-hidden="true" />
          {props.screenShareLabel === "Share Screen" ? (
            <>
              <span className="hidden sm:inline">Share Screen</span>
              <span className="sm:hidden">Share</span>
            </>
          ) : (
            props.screenShareLabel
          )}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={props.pipDisabled}
        onClick={props.onPip}
      >
        <PictureInPicture2 aria-hidden="true" />
        {props.pipLabel}
      </Button>
      <Button
        type="button"
        variant="outline"
        aria-label="Background & Settings"
        onClick={props.onSettings}
      >
        <Settings aria-hidden="true" />
        <span className="hidden sm:inline">Background &amp; Settings</span>
        <span className="sm:hidden">Background</span>
      </Button>
      <Button
        type="button"
        variant="destructive"
        disabled={props.leaveDisabled}
        onClick={props.onLeave}
      >
        <PhoneOff aria-hidden="true" />
        Leave
      </Button>
      <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2 [--rtk-space-5:8px] [--rtk-space-3:8px] [--rtk-space-6:16px] [--rtk-space-12:36px] [--rtk-controlbar-button-icon-size:16px] [&>rtk-more-toggle]:h-9">
        <Button
          type="button"
          variant={props.notesPanelOpen ? "secondary" : "outline"}
          aria-label={props.notesPanelOpen ? "Hide Notes & Transcript" : "Show Notes & Transcript"}
          aria-expanded={props.notesPanelOpen}
          aria-controls="talk-notes-transcript"
          onClick={props.onToggleNotesPanel}
        >
          {props.notesPanelOpen ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}
          <span className="hidden sm:inline">Notes &amp; Transcript</span>
          <span className="sm:hidden">Notes</span>
        </Button>
        {props.children}
      </div>
    </div>
    </div>
  )
}
